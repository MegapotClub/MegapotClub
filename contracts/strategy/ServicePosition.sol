// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BaseUsdcVault} from "../BaseUsdcVault.sol";
import {EthereumUsdcVault} from "../transport/EthereumUsdcVault.sol";

/// @notice One shared ETH strategy's registered downstream positions, independent of unsolicited gifts.
contract ServicePosition is ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum Kind { Base, Ethereum }
    struct Request { bool known; bool deposit; bool closed; bool exitSent; }
    address public immutable controller;
    IERC20 public immutable asset;
    address public immutable service;
    Kind public immutable kind;
    mapping(uint256 => Request) public deposits;
    mapping(uint256 => Request) public redeems;
    uint256 public openRequests;
    uint256 public ownedShares;
    uint256 public cash;
    bool public draining;
    error Unauthorized();
    error WrongState();
    error InexactMovement();
    event Allocated(uint256 indexed request, uint256 assets);
    event ExitStarted(uint256 indexed request, uint256 shares);
    event RequestClosed(uint256 indexed request, bool deposit);
    event CashReturned(uint256 assets);

    constructor(IERC20 asset_, address service_, Kind kind_, address controller_) {
        if (controller_ == address(0) || service_.code.length == 0 ||
            (kind_ == Kind.Base ? address(BaseUsdcVault(service_).asset()) : address(EthereumUsdcVault(service_).token())) != address(asset_)) revert WrongState();
        controller = controller_; asset = asset_; service = service_; kind = kind_;
    }
    modifier onlyController() { if (msg.sender != controller) revert Unauthorized(); _; }
    function closed() public view returns (bool) { return openRequests == 0 && ownedShares == 0 && cash == 0; }
    function upstreamStopped() external view returns (bool) {
        if (kind == Kind.Ethereum) return EthereumUsdcVault(service).remoteStopped();
        BaseUsdcVault v = BaseUsdcVault(service);
        return v.terminal() || v.jackpot().emergencyMode();
    }
    function beginCycle() external onlyController { if (!closed()) revert WrongState(); draining = false; }
    function beginDrain() external onlyController { draining = true; }
    function allocate(uint256 amount) external onlyController nonReentrant returns (uint256 id) {
        if (draining || amount == 0) revert WrongState();
        uint256 beforeCash = asset.balanceOf(address(this)); asset.safeTransferFrom(controller, address(this), amount);
        if (asset.balanceOf(address(this)) - beforeCash != amount) revert InexactMovement();
        asset.forceApprove(service, amount);
        if (kind == Kind.Base) id = BaseUsdcVault(service).requestDeposit(amount, address(this));
        else id = EthereumUsdcVault(service).requestDeposit(amount, address(this));
        asset.forceApprove(service, 0);
        deposits[id] = Request(true, true, false, false); openRequests++; emit Allocated(id, amount);
    }
    function cancelDeposit(uint256 id) external nonReentrant {
        Request storage r = deposits[id]; if (!draining || !r.known || r.closed || r.exitSent) revert WrongState();
        r.exitSent = true;
        if (kind == Kind.Base) {
            (, uint256 units, bool cancelled) = BaseUsdcVault(service).deposits(id);
            if (units != 0 && !cancelled) BaseUsdcVault(service).cancelDeposit(id);
        } else {
            EthereumUsdcVault.Operation memory o = EthereumUsdcVault(service).getOperation(id);
            if (!o.finalized && !o.exitRequested) EthereumUsdcVault(service).requestExit(id);
        }
    }
    function retrieveWaiting(uint256 id) external nonReentrant {
        Request storage r = deposits[id];
        if (kind != Kind.Base || !draining || !r.known || r.closed) revert WrongState();
        cash += BaseUsdcVault(service).claimCancelled(id, address(this), false);
    }
    function claimDepositLot(uint256 lot) external nonReentrant {
        if (kind != Kind.Base) revert WrongState(); BaseUsdcVault vault = BaseUsdcVault(service);
        (uint256 id,,,,) = vault.depositLots(lot); if (!deposits[id].known || deposits[id].closed) revert WrongState();
        (bool ready, bool asCash,) = vault.depositClaim(lot); if (!ready) revert WrongState();
        uint256 amount = vault.claimDeposit(lot, address(this));
        if (asCash) cash += amount; else ownedShares += amount;
    }
    function startRedeem() external nonReentrant returns (uint256 id) {
        uint256 shares = ownedShares; if (!draining || shares == 0) revert WrongState(); ownedShares = 0;
        if (kind == Kind.Base) {
            BaseUsdcVault v = BaseUsdcVault(service);
            if (v.terminal()) { cash += v.redeemRecovered(shares, address(this)); return 0; }
            id = v.requestRedeem(shares, address(this));
        } else id = EthereumUsdcVault(service).requestRedeem(shares, address(this));
        redeems[id] = Request(true, false, false, true); openRequests++; emit ExitStarted(id, shares);
    }
    function claimExitLot(uint256 lot) external nonReentrant {
        if (kind != Kind.Base) revert WrongState(); BaseUsdcVault v = BaseUsdcVault(service);
        (uint256 id,,,,) = v.exitLots(lot); if (!redeems[id].known || redeems[id].closed) revert WrongState();
        cash += v.claimExit(lot, address(this));
    }
    function recoverLockedRedeem(uint256 id) external nonReentrant {
        if (kind != Kind.Base || !redeems[id].known || redeems[id].closed) revert WrongState();
        BaseUsdcVault v = BaseUsdcVault(service); if (!v.terminal()) revert WrongState();
        uint256 shares = v.cancelRedeem(id, address(this)); cash += v.redeemRecovered(shares, address(this));
    }
    function collectRemote(uint256 id, bool deposit) external nonReentrant {
        Request storage r = deposit ? deposits[id] : redeems[id];
        if (kind != Kind.Ethereum || !r.known || r.closed) revert WrongState();
        EthereumUsdcVault v = EthereumUsdcVault(service); EthereumUsdcVault.Operation memory o = v.getOperation(id);
        if (o.unclaimedShares != 0) ownedShares += v.claimShares(id, address(this));
        if (o.cash != 0 && (o.burned || o.exitRequested)) cash += v.claimCash(id, address(this));
    }
    // @cc [label:security] registered-operation-closure
    // Only operations created by this position count toward closure. Donations and unsolicited controller gifts MUST NOT block pricing.
    function closeRequest(uint256 id, bool deposit) external nonReentrant {
        Request storage r = deposit ? deposits[id] : redeems[id]; if (!r.known || r.closed) revert WrongState();
        if (kind == Kind.Base) {
            BaseUsdcVault v = BaseUsdcVault(service);
            if (!(deposit ? v.depositRequestClosed(id) : v.redeemRequestClosed(id))) revert WrongState();
        } else {
            EthereumUsdcVault v = EthereumUsdcVault(service); EthereumUsdcVault.Operation memory o = v.getOperation(id);
            if (o.cash != 0 || o.unclaimedShares != 0) revert WrongState();
            if (!o.finalized) v.finalizeOperation(id);
        }
        r.closed = true; openRequests--; emit RequestClosed(id, deposit);
    }
    function returnCash() external onlyController nonReentrant returns (uint256 amount) {
        amount = cash; cash = 0; if (amount != 0) asset.safeTransfer(controller, amount); emit CashReturned(amount);
    }
}
