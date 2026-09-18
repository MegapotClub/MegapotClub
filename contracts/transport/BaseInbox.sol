// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BaseUsdcVault} from "../BaseUsdcVault.sol";
import {CctpRoute} from "./CctpRoute.sol";

/// @notice Fixed remote owner of Base service requests; arrival accounting never depends on native capacity or lender liquidity.
contract BaseInbox is CctpRoute {
    using SafeERC20 for IERC20;
    struct Operation {
        address owner; uint256 cash; uint256 depositRequest; uint256 pendingRedeemShares; uint256 openRedeems;
        uint256 activationCount; uint256 activatedShares; uint256 returnCount; uint256 returnedCash;
        bool arrived; bool exitRequested; bool closed; bool redemption;
    }
    BaseUsdcVault public immutable service;
    mapping(uint256 => Operation) public operations;
    mapping(uint256 => uint256) public depositOperation;
    mapping(uint256 => uint256) public redeemOperation;
    mapping(uint256 => bool) public redeemClosed;
    uint256 public reservedCash;
    uint256 public backingShares;
    uint256 public redeemShares;
    bool public stopAnnounced;
    error WrongState();
    event Invested(uint256 indexed operation, uint256 indexed request, uint256 assets);
    event RemoteExitStarted(uint256 indexed operation, uint256 indexed request, uint256 shares);
    event RemoteClosed(uint256 indexed operation);

    constructor(RouteConfig memory config, BaseUsdcVault service_) CctpRoute(config) {
        if (address(service_).code.length == 0 || address(service_.asset()) != address(config.token)) revert InvalidRoute();
        service = service_;
    }
    function announceStop() external nonReentrant {
        if (stopAnnounced || (!service.terminal() && !service.jackpot().emergencyMode())) revert WrongState();
        stopAnnounced = true; _sendControl(Message(STOP, 1, peer, 1, 0, 0, 0));
    }
    function _bind(Operation storage o, Message memory m) private {
        if (o.owner == address(0)) o.owner = m.owner;
        else if (o.owner != m.owner) revert InvalidMessage();
    }
    function _receiveAsset(Message memory m) internal override {
        Operation storage o = operations[m.operation]; _bind(o, m);
        if (m.kind != DEPOSIT || m.sequence != 1 || o.arrived || o.redemption || o.closed) revert InvalidMessage();
        o.arrived = true; o.cash += m.amount; reservedCash += m.amount;
    }
    function _receiveControl(Message memory m) internal override {
        Operation storage o = operations[m.operation]; _bind(o, m);
        if (m.sequence != 0 || m.aux != 0 || m.total != 0) revert InvalidMessage();
        if (m.kind == EXIT) {
            if (m.amount != 0 || o.redemption) revert InvalidMessage();
            // An exit arriving after the deposit operation closed is harmless; already announced receipts remain redeemable on L1.
            o.exitRequested = true;
        } else if (m.kind == REDEEM) {
            if (o.arrived || o.redemption || o.depositRequest != 0 || o.exitRequested || o.closed || m.amount == 0) revert InvalidMessage();
            o.arrived = true; o.redemption = true; o.exitRequested = true;
            backingShares -= m.amount; redeemShares += m.amount; o.pendingRedeemShares = m.amount;
        } else revert InvalidMessage();
    }
    function invest(uint256 id) external nonReentrant {
        Operation storage o = operations[id];
        if (!o.arrived || o.exitRequested || o.closed || o.depositRequest != 0 || o.cash == 0) revert WrongState();
        uint256 amount = o.cash; o.cash = 0; reservedCash -= amount;
        token.forceApprove(address(service), amount);
        uint256 request = service.requestDeposit(amount, address(this)); token.forceApprove(address(service), 0);
        o.depositRequest = request; depositOperation[request] = id;
        emit Invested(id, request, amount);
    }
    function cancelWaiting(uint256 id) external nonReentrant {
        Operation storage o = operations[id];
        if (!o.exitRequested || o.closed || o.depositRequest == 0) revert WrongState();
        (, uint256 units, bool cancelled) = service.deposits(o.depositRequest);
        if (units == 0) revert WrongState();
        if (!cancelled) service.cancelDeposit(o.depositRequest);
    }
    function retrieveWaiting(uint256 id) external nonReentrant {
        Operation storage o = operations[id];
        if ((!o.exitRequested && !service.terminal()) || o.closed || o.depositRequest == 0) revert WrongState();
        uint256 beforeCash = token.balanceOf(address(this));
        uint256 cash = service.claimCancelled(o.depositRequest, address(this), false);
        if (token.balanceOf(address(this)) - beforeCash != cash) revert InexactTransport();
        o.cash += cash; reservedCash += cash;
    }
    function claimDepositLot(uint256 lotId) external nonReentrant {
        (uint256 request,,,,) = service.depositLots(lotId);
        uint256 id = depositOperation[request]; Operation storage o = operations[id];
        if (id == 0 || o.closed) revert WrongState();
        (bool ready, bool cash,) = service.depositClaim(lotId); if (!ready) revert WrongState();
        uint256 amount = service.claimDeposit(lotId, address(this));
        if (cash) { o.cash += amount; reservedCash += amount; }
        else if (o.exitRequested) { o.pendingRedeemShares += amount; redeemShares += amount; }
        else {
            backingShares += amount; o.activatedShares += amount;
            _sendControl(Message(ACTIVATE, id, o.owner, ++o.activationCount, amount, 0, 0));
        }
    }
    function startRedeem(uint256 id) external nonReentrant {
        Operation storage o = operations[id]; uint256 shares = o.pendingRedeemShares;
        if (shares == 0 || o.closed) revert WrongState();
        o.pendingRedeemShares = 0; redeemShares -= shares;
        if (service.terminal()) {
            uint256 amount = service.redeemRecovered(shares, address(this)); o.cash += amount; reservedCash += amount;
        } else {
            uint256 request = service.requestRedeem(shares, address(this));
            redeemOperation[request] = id; o.openRedeems++; emit RemoteExitStarted(id, request, shares);
        }
    }
    function claimExitLot(uint256 lotId) external nonReentrant {
        (uint256 request,,,,) = service.exitLots(lotId);
        uint256 id = redeemOperation[request]; Operation storage o = operations[id];
        if (id == 0 || o.closed) revert WrongState();
        uint256 amount = service.claimExit(lotId, address(this)); o.cash += amount; reservedCash += amount;
    }
    function recoverLockedRedeem(uint256 request) external nonReentrant {
        uint256 id = redeemOperation[request]; Operation storage o = operations[id];
        if (id == 0 || !service.terminal() || o.closed) revert WrongState();
        uint256 shares = service.cancelRedeem(request, address(this));
        uint256 amount = service.redeemRecovered(shares, address(this)); o.cash += amount; reservedCash += amount;
    }
    function closeRedeem(uint256 request) external {
        uint256 id = redeemOperation[request];
        if (id == 0 || redeemClosed[request] || !service.redeemRequestClosed(request)) revert WrongState();
        redeemClosed[request] = true; operations[id].openRedeems--;
    }
    function returnCash(uint256 id, uint256 maxAmount) external nonReentrant {
        Operation storage o = operations[id]; uint256 amount = Math.min(o.cash, maximumBurn);
        if (o.owner == address(0) || o.closed || amount == 0 || maxAmount < amount) revert WrongState();
        // Cash is either not invested, an emergency refund, or exit proceeds; ordinary arrived cash needs the owner's exit intent.
        if (!o.exitRequested && o.depositRequest == 0) revert WrongState();
        o.cash -= amount; reservedCash -= amount; o.returnedCash += amount;
        _sendAsset(Message(RETURN, id, o.owner, ++o.returnCount, amount, 0, 0));
    }
    // @cc [label:accounting] remote-closure-frontier
    // Closure MUST exclude every remaining service entitlement and identify every asset/control return. L1 must wait for all of them.
    function closeOperation(uint256 id) external nonReentrant {
        Operation storage o = operations[id];
        if (!o.arrived || o.closed || o.cash != 0 || o.pendingRedeemShares != 0 || o.openRedeems != 0 ||
            (o.depositRequest == 0 && !o.exitRequested) ||
            (o.depositRequest != 0 && !service.depositRequestClosed(o.depositRequest))) revert WrongState();
        o.closed = true;
        _sendControl(Message(CLOSE, id, o.owner, o.activationCount, o.activatedShares, o.returnCount, o.returnedCash));
        emit RemoteClosed(id);
    }
}
