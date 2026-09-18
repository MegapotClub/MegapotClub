// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {WaitingEscrow} from "./WaitingEscrow.sol";
import {INativeJackpot, INativeLPManager, IAavePool, IScaledToken} from "./interfaces/External.sol";

/// @notice Transferable native-share receipts with separately owned async requests.
/// @dev Purpose-built async interface. Does not advertise ERC-4626/7540 conformance.
contract BaseUsdcVault is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant MAX_WORK = 64;
    uint256 private constant PRECISION = 1e18;
    IERC20 public immutable asset;
    INativeJackpot public immutable jackpot;
    INativeLPManager public immutable manager;
    WaitingEscrow public immutable waiting;
    uint256 public immutable minimumDeposit;

    enum BatchState { Pending, Shares, Cash }
    struct Batch { uint256 input; uint256 output; BatchState state; }
    struct DepositRequest { address controller; uint256 units; bool cancelled; }
    struct RedeemRequest { address controller; uint256 shares; }
    struct Lot { uint256 request; uint256 draw; uint256 start; uint256 amount; bool claimed; }
    mapping(uint256 => DepositRequest) public deposits;
    mapping(uint256 => RedeemRequest) public redeems;
    mapping(uint256 => Lot) public depositLots;
    mapping(uint256 => Lot) public exitLots;
    mapping(uint256 => Batch) public depositBatches;
    mapping(uint256 => Batch) public exitBatches;
    mapping(address => mapping(address => bool)) public isOperator;
    mapping(address => uint256) public waitingUnitsOf;
    mapping(address => uint256) public lockedSharesOf;
    mapping(address => uint256) public depositLotsOf;
    mapping(address => uint256) public exitLotsOf;
    mapping(uint256 => uint256) public pendingDepositLots;
    mapping(uint256 => uint256) public pendingExitLots;
    uint256 public nextDeposit = 1;
    uint256 public nextRedeem = 1;
    uint256 public nextDepositLot = 1;
    uint256 public nextExitLot = 1;
    uint256 public depositHead = 1;
    uint256 public redeemHead = 1;
    bool public hasPendingDeposit;
    bool public hasPendingExit;
    uint256 public pendingDepositDraw;
    uint256 public pendingExitDraw;
    uint256 public earnedEscrowShares;
    uint256 public lockedShares;
    uint256 public reservedCash;
    bool public terminal;
    uint256 public recoverySupply;
    uint256 public recoveryCash;
    uint256 public recoveredShares;

    error InvalidConfiguration();
    error Unauthorized();
    error InvalidAmount();
    error InvalidReceiver();
    error NotReady();
    error Stopped();
    error InexactMovement();
    error WorkLimit();
    event DepositRequested(uint256 indexed id, address indexed controller, address indexed payer, uint256 assets, uint256 units);
    event DepositCancelled(uint256 indexed id);
    event WaitingClaimed(uint256 indexed id, address indexed receiver, uint256 units, uint256 amount, bool inKind);
    event DepositCommitted(uint256 indexed lot, uint256 indexed request, uint256 indexed draw, uint256 assets);
    event DepositSettled(uint256 indexed draw, uint256 assets, uint256 shares, bool refund);
    event DepositClaimed(uint256 indexed lot, address indexed receiver, uint256 amount, bool cash);
    event RedeemRequested(uint256 indexed id, address indexed controller, uint256 shares);
    event RedeemCancelled(uint256 indexed id, address indexed receiver, uint256 shares);
    event ExitCommitted(uint256 indexed lot, uint256 indexed request, uint256 indexed draw, uint256 shares);
    event ExitSettled(uint256 indexed draw, uint256 shares, uint256 assets);
    event ExitClaimed(uint256 indexed lot, address indexed receiver, uint256 assets);
    event OperatorSet(address indexed controller, address indexed operator, bool approved);
    event Recovered(uint256 receiptCash, uint256 receiptSupply, uint256 depositRefund, uint256 exitCash);
    event RecoveryClaimed(address indexed owner, address indexed receiver, uint256 shares, uint256 assets);

    constructor(IERC20 asset_, INativeJackpot jackpot_, INativeLPManager manager_, IAavePool pool_, IScaledToken aToken_, uint256 minimumDeposit_)
        ERC20("Megapot Club Base USDC", "mcUSDC")
    {
        if (address(jackpot_).code.length == 0 || address(manager_).code.length == 0 || minimumDeposit_ == 0 ||
            jackpot_.jackpotLPManager() != address(manager_) || jackpot_.usdc() != address(asset_)) revert InvalidConfiguration();
        asset = asset_; jackpot = jackpot_; manager = manager_; minimumDeposit = minimumDeposit_;
        waiting = new WaitingEscrow(asset_, pool_, aToken_, address(this));
    }
    function decimals() public pure override returns (uint8) { return 6; }
    function setOperator(address operator, bool approved) external {
        if (operator == address(0) || operator == msg.sender) revert InvalidReceiver();
        isOperator[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
    }
    function _auth(address controller) private view {
        if (controller == address(0) || (msg.sender != controller && !isOperator[controller][msg.sender])) revert Unauthorized();
    }
    function _receiver(address receiver) private view {
        if (receiver == address(0) || receiver == address(this) || receiver == address(waiting)) revert InvalidReceiver();
    }
    function _live() private view { if (terminal || jackpot.emergencyMode()) revert Stopped(); }
    function _bound(uint256 n) private pure { if (n == 0 || n > MAX_WORK) revert WorkLimit(); }

    function requestDeposit(uint256 assets, address controller) external nonReentrant returns (uint256 id) {
        _live(); _receiver(controller);
        if (assets < minimumDeposit) revert InvalidAmount();
        uint256 beforeCash = asset.balanceOf(address(waiting));
        asset.safeTransferFrom(msg.sender, address(waiting), assets);
        if (asset.balanceOf(address(waiting)) - beforeCash != assets) revert InexactMovement();
        uint256 units = waiting.supply(assets);
        id = nextDeposit++;
        deposits[id] = DepositRequest(controller, units, false);
        waitingUnitsOf[controller] += units;
        emit DepositRequested(id, controller, msg.sender, assets, units);
    }

    /// @notice Immediately removes the remaining waiting portion from eligibility; retrieval may await Aave liquidity.
    function cancelDeposit(uint256 id) external {
        DepositRequest storage r = deposits[id]; _auth(r.controller);
        if (r.cancelled || r.units == 0) revert InvalidAmount();
        r.cancelled = true; emit DepositCancelled(id);
    }
    function claimCancelled(uint256 id, address receiver, bool inKind) external nonReentrant returns (uint256 assets) {
        DepositRequest storage r = deposits[id]; _auth(r.controller); _receiver(receiver);
        if ((!r.cancelled && !terminal && !jackpot.emergencyMode()) || r.units == 0) revert NotReady();
        r.cancelled = true;
        uint256 burned;
        if (inKind) (burned, assets) = waiting.retrieveInKind(r.units, receiver);
        else (burned, assets) = waiting.retrieve(r.units, type(uint256).max);
        r.units -= burned; waitingUnitsOf[r.controller] -= burned;
        if (!inKind) asset.safeTransfer(receiver, assets);
        emit WaitingClaimed(id, receiver, burned, assets, inKind);
    }

    // @cc [label:accounting] fifo-native-admission
    // Fill only the oldest eligible waiting request; partial fills retain its place. Each loop iteration counts toward MAX_WORK.
    function processDeposits(uint256 maxRequests, uint256 maxAssets) external nonReentrant returns (uint256 committed) {
        _live(); _bound(maxRequests); _syncDeposits(); _syncExits();
        uint256 draw = jackpot.currentDrawingId();
        uint256 cap = manager.lpPoolCap();
        uint256 estimated = manager.getEstimatedNextDrawingLpPool();
        uint256 budget = Math.min(maxAssets, cap > estimated ? cap - estimated : 0);
        for (uint256 n; n < maxRequests && depositHead < nextDeposit; ++n) {
            DepositRequest storage r = deposits[depositHead];
            if (r.cancelled || r.units == 0) { ++depositHead; continue; }
            if (budget == 0) break;
            uint256 available = waiting.assetsForUnits(r.units);
            // Native granularity can make a tiny remainder useless; retain its owner's cancellation claim.
            if (available == 0) { r.cancelled = true; emit DepositCancelled(depositHead++); continue; }
            if (budget < minimumDeposit && budget < available) break;
            if (waiting.retrievalAmount(r.units, budget) == 0) break;
            (uint256 burned, uint256 amount) = waiting.retrieve(r.units, Math.min(budget, available));
            r.units -= burned; waitingUnitsOf[r.controller] -= burned;
            _commitDeposit(depositHead, draw, amount);
            committed += amount; budget -= amount;
            if (r.units == 0) ++depositHead;
        }
    }
    function _commitDeposit(uint256 request, uint256 draw, uint256 amount) private {
        Batch storage b = depositBatches[draw];
        uint256 lotId = nextDepositLot - 1;
        Lot storage previous = depositLots[lotId];
        if (lotId != 0 && previous.request == request && previous.draw == draw && !previous.claimed) {
            previous.amount += amount;
        } else {
            lotId = nextDepositLot++;
            depositLots[lotId] = Lot(request, draw, b.input, amount, false);
            depositLotsOf[deposits[request].controller]++; pendingDepositLots[request]++;
        }
        b.input += amount;
        hasPendingDeposit = true; pendingDepositDraw = draw;
        asset.forceApprove(address(jackpot), amount);
        uint256 beforeCash = asset.balanceOf(address(this));
        jackpot.lpDeposit(amount);
        asset.forceApprove(address(jackpot), 0);
        if (beforeCash - asset.balanceOf(address(this)) != amount) revert InexactMovement();
        emit DepositCommitted(lotId, request, draw, amount);
    }
    function syncDeposits() external nonReentrant { _syncDeposits(); }
    function _syncDeposits() private {
        if (!hasPendingDeposit || pendingDepositDraw >= jackpot.currentDrawingId()) return;
        Batch storage b = depositBatches[pendingDepositDraw];
        b.output = Math.mulDiv(b.input, PRECISION, manager.getDrawingAccumulator(pendingDepositDraw));
        b.state = BatchState.Shares; hasPendingDeposit = false;
        earnedEscrowShares += b.output; _mint(address(this), b.output);
        emit DepositSettled(pendingDepositDraw, b.input, b.output, false);
    }
    function _allocation(Lot storage lot, Batch storage batch) private view returns (uint256) {
        return Math.mulDiv(batch.output, lot.start + lot.amount, batch.input) - Math.mulDiv(batch.output, lot.start, batch.input);
    }
    function depositClaim(uint256 lotId) public view returns (bool ready, bool cash, uint256 amount) {
        Lot storage lot = depositLots[lotId]; Batch storage b = depositBatches[lot.draw];
        if (lot.amount == 0 || lot.claimed) return (false, false, 0);
        if (b.state != BatchState.Pending) return (true, b.state == BatchState.Cash, _allocation(lot, b));
        if (lot.draw < jackpot.currentDrawingId()) {
            uint256 q = Math.mulDiv(b.input, PRECISION, manager.getDrawingAccumulator(lot.draw));
            return (true, false, Math.mulDiv(q, lot.start + lot.amount, b.input) - Math.mulDiv(q, lot.start, b.input));
        }
    }
    function claimDeposit(uint256 lotId, address receiver) external nonReentrant returns (uint256 amount) {
        Lot storage lot = depositLots[lotId]; _auth(deposits[lot.request].controller); _receiver(receiver);
        Batch storage b = depositBatches[lot.draw];
        if (b.state == BatchState.Pending) _syncDeposits();
        if (lot.claimed || lot.amount == 0 || b.state == BatchState.Pending) revert NotReady();
        amount = _allocation(lot, b); lot.claimed = true; depositLotsOf[deposits[lot.request].controller]--; pendingDepositLots[lot.request]--;
        bool cash = b.state == BatchState.Cash;
        if (cash) { reservedCash -= amount; if (amount != 0) asset.safeTransfer(receiver, amount); }
        else { earnedEscrowShares -= amount; _transfer(address(this), receiver, amount); }
        emit DepositClaimed(lotId, receiver, amount, cash);
    }

    function requestRedeem(uint256 shares, address controller) external nonReentrant returns (uint256 id) {
        _receiver(controller); if (shares == 0 || terminal) revert InvalidAmount();
        _transfer(msg.sender, address(this), shares);
        id = nextRedeem++; redeems[id] = RedeemRequest(controller, shares);
        lockedShares += shares; lockedSharesOf[controller] += shares;
        emit RedeemRequested(id, controller, shares);
    }
    function cancelRedeem(uint256 id, address receiver) external nonReentrant returns (uint256 shares) {
        RedeemRequest storage r = redeems[id]; _auth(r.controller); _receiver(receiver);
        shares = r.shares; if (shares == 0) revert InvalidAmount();
        r.shares = 0; lockedShares -= shares; lockedSharesOf[r.controller] -= shares;
        _transfer(address(this), receiver, shares); emit RedeemCancelled(id, receiver, shares);
    }
    function processRedeems(uint256 maxRequests, uint256 maxShares) external nonReentrant returns (uint256 accepted) {
        _live(); _bound(maxRequests); _syncDeposits(); _syncExits();
        uint256 draw = jackpot.currentDrawingId();
        for (uint256 n; n < maxRequests && redeemHead < nextRedeem; ++n) {
            RedeemRequest storage r = redeems[redeemHead];
            if (r.shares == 0) { ++redeemHead; continue; }
            uint256 amount = Math.min(r.shares, maxShares - accepted); if (amount == 0) break;
            uint256 lastAccumulator = draw == 0 ? PRECISION : manager.getDrawingAccumulator(draw - 1);
            if (amount < r.shares && Math.mulDiv(amount, lastAccumulator, PRECISION) < minimumDeposit) break;
            Batch storage b = exitBatches[draw];
            uint256 lotId = nextExitLot - 1;
            Lot storage previous = exitLots[lotId];
            if (lotId != 0 && previous.request == redeemHead && previous.draw == draw && !previous.claimed) {
                previous.amount += amount;
            } else {
                lotId = nextExitLot++;
                exitLots[lotId] = Lot(redeemHead, draw, b.input, amount, false);
                exitLotsOf[r.controller]++; pendingExitLots[redeemHead]++;
            }
            b.input += amount;
            r.shares -= amount; lockedShares -= amount; lockedSharesOf[r.controller] -= amount;
            _burn(address(this), amount); hasPendingExit = true; pendingExitDraw = draw;
            jackpot.initiateWithdraw(amount);
            emit ExitCommitted(lotId, redeemHead, draw, amount); accepted += amount;
            if (r.shares == 0) ++redeemHead;
        }
    }
    function syncExits() external nonReentrant { _syncExits(); }
    function _syncExits() private {
        if (!hasPendingExit || pendingExitDraw >= jackpot.currentDrawingId()) return;
        if (jackpot.emergencyMode()) revert Stopped();
        Batch storage b = exitBatches[pendingExitDraw];
        uint256 assets = Math.mulDiv(b.input, manager.getDrawingAccumulator(pendingExitDraw), PRECISION);
        if (assets != 0) {
            uint256 beforeCash = asset.balanceOf(address(this)); jackpot.finalizeWithdraw();
            if (asset.balanceOf(address(this)) - beforeCash != assets) revert InexactMovement();
        }
        // Native finalize reverts for zero-valued exits; later native consolidation clears its zero record.
        b.output = assets; b.state = BatchState.Cash; reservedCash += assets; hasPendingExit = false;
        emit ExitSettled(pendingExitDraw, b.input, assets);
    }
    function exitClaim(uint256 lotId) public view returns (bool ready, uint256 amount) {
        Lot storage lot = exitLots[lotId]; Batch storage b = exitBatches[lot.draw];
        if (lot.amount != 0 && !lot.claimed && b.state == BatchState.Cash) return (true, _allocation(lot, b));
    }
    function claimExit(uint256 lotId, address receiver) external nonReentrant returns (uint256 amount) {
        Lot storage lot = exitLots[lotId]; _auth(redeems[lot.request].controller); _receiver(receiver);
        Batch storage b = exitBatches[lot.draw];
        if (b.state == BatchState.Pending && !terminal) _syncExits();
        if (lot.claimed || lot.amount == 0 || b.state != BatchState.Cash) revert NotReady();
        amount = _allocation(lot, b); lot.claimed = true; exitLotsOf[redeems[lot.request].controller]--; pendingExitLots[lot.request]--;
        reservedCash -= amount; if (amount != 0) asset.safeTransfer(receiver, amount);
        emit ExitClaimed(lotId, receiver, amount);
    }

    // @cc [label:accounting] emergency-owner-separation
    // Native emergency return MUST separately back pending-deposit refunds, accepted exits and outstanding receipt ownership.
    function recoverNative() external nonReentrant {
        if (terminal || !jackpot.emergencyMode()) revert NotReady();
        _syncDeposits();
        uint256 draw = jackpot.currentDrawingId();
        uint256 accumulator = draw == 0 ? PRECISION : manager.getDrawingAccumulator(draw - 1);
        uint256 refunds = hasPendingDeposit ? depositBatches[pendingDepositDraw].input : 0;
        uint256 exits;
        if (hasPendingExit) {
            Batch storage b = exitBatches[pendingExitDraw];
            uint256 exitAccumulator = pendingExitDraw < draw ? manager.getDrawingAccumulator(pendingExitDraw) : accumulator;
            exits = Math.mulDiv(b.input, exitAccumulator, PRECISION);
            b.output = exits; b.state = BatchState.Cash; hasPendingExit = false;
            emit ExitSettled(pendingExitDraw, b.input, exits);
        }
        recoverySupply = totalSupply(); recoveryCash = Math.mulDiv(recoverySupply, accumulator, PRECISION);
        uint256 expected = refunds + exits + recoveryCash;
        uint256 beforeCash = asset.balanceOf(address(this)); jackpot.emergencyWithdrawLP();
        if (asset.balanceOf(address(this)) - beforeCash != expected) revert InexactMovement();
        if (hasPendingDeposit) {
            Batch storage b = depositBatches[pendingDepositDraw]; b.output = refunds; b.state = BatchState.Cash;
            hasPendingDeposit = false; emit DepositSettled(pendingDepositDraw, b.input, refunds, true);
        }
        reservedCash += expected; terminal = true;
        emit Recovered(recoveryCash, recoverySupply, refunds, exits);
    }
    function redeemRecovered(uint256 shares, address receiver) external nonReentrant returns (uint256 assets) {
        _receiver(receiver); if (!terminal || shares == 0) revert NotReady();
        assets = Math.mulDiv(recoveryCash, recoveredShares + shares, recoverySupply) - Math.mulDiv(recoveryCash, recoveredShares, recoverySupply);
        recoveredShares += shares; _burn(msg.sender, shares); reservedCash -= assets;
        if (assets != 0) asset.safeTransfer(receiver, assets);
        emit RecoveryClaimed(msg.sender, receiver, shares, assets);
    }
    /// @notice Active receipt value only; excludes unissued pending cohorts, waiting and fixed cash.
    function activeAssets() external view returns (uint256) {
        if (terminal) return recoveryCash - Math.mulDiv(recoveryCash, recoveredShares, recoverySupply == 0 ? 1 : recoverySupply);
        uint256 draw = jackpot.currentDrawingId();
        return Math.mulDiv(totalSupply(), draw == 0 ? PRECISION : manager.getDrawingAccumulator(draw - 1), PRECISION);
    }
    /// @notice Local closure test for a downstream strategy; transfer/exits must also consume every controller entitlement.
    function exposureClosed(address controller) external view returns (bool) {
        return balanceOf(controller) == 0 && waitingUnitsOf[controller] == 0 && lockedSharesOf[controller] == 0 &&
            depositLotsOf[controller] == 0 && exitLotsOf[controller] == 0;
    }
    function depositRequestClosed(uint256 id) external view returns (bool) {
        return deposits[id].controller != address(0) && deposits[id].units == 0 && pendingDepositLots[id] == 0;
    }
    function redeemRequestClosed(uint256 id) external view returns (bool) {
        return redeems[id].controller != address(0) && redeems[id].shares == 0 && pendingExitLots[id] == 0;
    }
}
