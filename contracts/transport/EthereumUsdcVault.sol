// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CctpRoute} from "./CctpRoute.sol";

/// @notice Ethereum receipts backed one-for-one by Base service shares, including authenticated in-flight ownership.
contract EthereumUsdcVault is ERC20, CctpRoute {
    using SafeERC20 for IERC20;
    struct Operation {
        address owner; uint256 cash; uint256 unclaimedShares; uint256 activationCount; uint256 activationShares;
        uint256 returnCount; uint256 returnedCash; uint256 finalActivations; uint256 finalShares;
        uint256 finalReturns; uint256 finalCash; bool burned; bool exitRequested; bool closeReceived; bool finalized; bool redemption;
    }
    mapping(uint256 => Operation) public operations;
    mapping(bytes32 => bool) public activationReceived;
    mapping(address => uint256) public openOperationsOf;
    mapping(address => uint256) public cashOf;
    mapping(address => uint256) public unclaimedSharesOf;
    uint256 public nextOperation = 1;
    uint256 public reservedCash;
    bool public remoteStopped;
    event Requested(uint256 indexed id, address indexed owner, uint256 assets, bool redemption);
    event ExitRequested(uint256 indexed id);
    event SharesEarned(uint256 indexed id, uint256 indexed sequence, uint256 shares);
    event SharesClaimed(uint256 indexed id, address indexed receiver, uint256 shares);
    event CashClaimed(uint256 indexed id, address indexed receiver, uint256 assets);
    event OperationClosed(uint256 indexed id);
    error Unauthorized();
    error WrongState();

    constructor(RouteConfig memory config) ERC20("Megapot Club Ethereum USDC", "mcUSDC-L1") CctpRoute(config) {}
    function decimals() public pure override returns (uint8) { return 6; }
    function _owner(Operation storage o) private view { if (o.owner == address(0) || msg.sender != o.owner) revert Unauthorized(); }
    function _receiver(address receiver) private view { if (receiver == address(0) || receiver == address(this)) revert WrongState(); }

    function requestDeposit(uint256 assets, address owner) external nonReentrant returns (uint256 id) {
        _receiver(owner); if (remoteStopped || assets == 0 || assets > maximumBurn) revert WrongState();
        uint256 beforeCash = token.balanceOf(address(this)); token.safeTransferFrom(msg.sender, address(this), assets);
        if (token.balanceOf(address(this)) - beforeCash != assets) revert InexactTransport();
        id = nextOperation++; Operation storage o = operations[id]; o.owner = owner; o.cash = assets;
        openOperationsOf[owner]++; cashOf[owner] += assets; reservedCash += assets;
        emit Requested(id, owner, assets, false);
    }
    function bridgeDeposit(uint256 id) external nonReentrant {
        Operation storage o = operations[id];
        if (remoteStopped || o.owner == address(0) || o.burned || o.exitRequested || o.redemption || o.cash == 0) revert WrongState();
        uint256 amount = o.cash; o.cash = 0; o.burned = true; reservedCash -= amount; cashOf[o.owner] -= amount;
        _sendAsset(Message(DEPOSIT, id, o.owner, 1, amount, 0, 0));
    }
    /// @notice Before burn, cancel locally. After burn, send an exit intent; it takes effect when received on Base.
    function requestExit(uint256 id) external nonReentrant {
        Operation storage o = operations[id]; _owner(o);
        if (o.finalized || o.exitRequested || o.redemption) revert WrongState();
        o.exitRequested = true;
        if (o.burned) _sendControl(Message(EXIT, id, o.owner, 0, 0, 0, 0));
        emit ExitRequested(id);
    }
    function requestRedeem(uint256 shares, address owner) external nonReentrant returns (uint256 id) {
        _receiver(owner); if (shares == 0) revert WrongState();
        _burn(msg.sender, shares);
        id = nextOperation++; Operation storage o = operations[id]; o.owner = owner; o.redemption = true; o.burned = true; o.exitRequested = true;
        openOperationsOf[owner]++;
        _sendControl(Message(REDEEM, id, owner, 0, shares, 0, 0));
        emit Requested(id, owner, shares, true);
    }
    function claimShares(uint256 id, address receiver) external nonReentrant returns (uint256 shares) {
        Operation storage o = operations[id]; _owner(o); _receiver(receiver);
        shares = o.unclaimedShares; if (shares == 0) revert WrongState();
        o.unclaimedShares = 0; unclaimedSharesOf[o.owner] -= shares;
        _transfer(address(this), receiver, shares); emit SharesClaimed(id, receiver, shares);
    }
    function claimCash(uint256 id, address receiver) external nonReentrant returns (uint256 assets) {
        Operation storage o = operations[id]; _owner(o); _receiver(receiver);
        if (!o.burned && !o.exitRequested) revert WrongState();
        assets = o.cash; if (assets == 0) revert WrongState();
        o.cash = 0; cashOf[o.owner] -= assets; reservedCash -= assets;
        token.safeTransfer(receiver, assets); emit CashClaimed(id, receiver, assets);
    }
    function finalizeOperation(uint256 id) external {
        Operation storage o = operations[id];
        if (o.owner == address(0) || o.finalized) revert WrongState();
        if (o.burned) {
            if (!o.closeReceived || o.activationCount != o.finalActivations || o.activationShares != o.finalShares ||
                o.returnCount != o.finalReturns || o.returnedCash != o.finalCash) revert WrongState();
        } else if (!o.exitRequested || o.cash != 0) revert WrongState();
        o.finalized = true; openOperationsOf[o.owner]--; emit OperationClosed(id);
    }
    function exposureClosed(address owner) external view returns (bool) {
        return balanceOf(owner) == 0 && openOperationsOf[owner] == 0 && cashOf[owner] == 0 && unclaimedSharesOf[owner] == 0;
    }
    function getOperation(uint256 id) external view returns (Operation memory) { return operations[id]; }
    function _receiveAsset(Message memory m) internal override {
        Operation storage o = operations[m.operation];
        if (m.kind != RETURN || o.owner != m.owner || !o.burned || o.finalized ||
            (o.closeReceived && (m.sequence > o.finalReturns || o.returnCount >= o.finalReturns))) revert InvalidMessage();
        o.returnCount++; o.returnedCash += m.amount; o.cash += m.amount;
        reservedCash += m.amount; cashOf[o.owner] += m.amount;
    }
    function _receiveControl(Message memory m) internal override {
        if (m.kind == STOP) {
            if (remoteStopped || m.operation != 1 || m.owner != address(this) || m.sequence != 1 || m.amount != 0 || m.aux != 0 || m.total != 0) revert InvalidMessage();
            remoteStopped = true; return;
        }
        Operation storage o = operations[m.operation];
        if (o.owner != m.owner || !o.burned || o.finalized) revert InvalidMessage();
        if (m.kind == ACTIVATE) {
            if (o.redemption || m.sequence == 0 || m.aux != 0 || m.total != 0 ||
                (o.closeReceived && (m.sequence > o.finalActivations || o.activationCount >= o.finalActivations))) revert InvalidMessage();
            bytes32 key = keccak256(abi.encode(m.operation, m.sequence)); if (activationReceived[key]) revert Replay();
            activationReceived[key] = true; o.activationCount++; o.activationShares += m.amount;
            o.unclaimedShares += m.amount; unclaimedSharesOf[o.owner] += m.amount; _mint(address(this), m.amount);
            emit SharesEarned(m.operation, m.sequence, m.amount);
        } else if (m.kind == CLOSE) {
            if (o.closeReceived || m.sequence < o.activationCount || m.amount < o.activationShares ||
                m.aux < o.returnCount || m.total < o.returnedCash) revert InvalidMessage();
            o.closeReceived = true; o.finalActivations = m.sequence; o.finalShares = m.amount; o.finalReturns = m.aux; o.finalCash = m.total;
        } else revert InvalidMessage();
    }
}
