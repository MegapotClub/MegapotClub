// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IWETH, IScaledToken} from "../interfaces/External.sol";
import {WaitingEscrow} from "../WaitingEscrow.sol";
import {ServicePosition} from "./ServicePosition.sol";
import {PriceGuard} from "./PriceGuard.sol";
import {IFlashPool, ISwapRouter02} from "./StrategyInterfaces.sol";

/// @notice One perpetual shared ETH pool. Supply changes only at a fully realized, debt-free WETH boundary.
/// @dev Instantiate separately on Base and Ethereum using their local lending, pricing and USDC service configuration.
contract SharedEthVault is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant MAX_WORK = 64;
    uint256 private constant BPS = 10000;
    uint256 private constant RAY = 1e27;
    struct Risk {
        uint256 borrowBps; uint256 reserveBps; uint256 maxDebt; uint256 minimumHealth;
        uint256 defenseHealth; uint256 slippageBps; uint256 flashPremiumBps; uint256 period; uint256 minimumDeposit;
    }
    struct Configuration {
        IWETH weth; IERC20 usdc; IFlashPool pool; IScaledToken aWeth; IERC20 variableDebt;
        ISwapRouter02 router; PriceGuard prices; uint24 swapFee; address service; ServicePosition.Kind kind; uint256 expectedChain;
    }
    enum Phase { Running, Draining, Terminal }
    struct Entry { address owner; uint256 batch; uint256 units; uint256 start; bool cancelled; bool claimed; }
    struct Exit { address owner; uint256 batch; uint256 shares; uint256 start; bool claimed; }
    struct Batch {
        uint256 entryUnits; uint256 exitShares; uint256 entryStart; uint256 exitStart; uint256 entryEnd; uint256 exitEnd;
        uint256 entryCursor; uint256 exitCursor; uint256 preparedUnits; uint256 preparedShares; uint256 retrievedUnits;
        uint256 entryCash; uint256 mintedShares; uint256 exitCash; uint256 sealedAt;
        uint256 refundUnits;
        bool settled; bool refundEntries; bool entriesAborted; bool refundReserved; bool inKindRefund;
    }
    IWETH public immutable weth;
    IERC20 public immutable usdc;
    IFlashPool public immutable pool;
    IScaledToken public immutable aWeth;
    IERC20 public immutable variableDebt;
    ISwapRouter02 public immutable router;
    PriceGuard public immutable prices;
    uint24 public immutable swapFee;
    WaitingEscrow public immutable waiting;
    ServicePosition public immutable position;
    Risk public risk;
    Phase public phase;
    uint256 public openBatch = 1;
    uint256 public sealedBatch;
    uint256 public nextEntry = 1;
    uint256 public nextExit = 1;
    uint256 public nextSealAt;
    mapping(uint256 => Entry) public entries;
    mapping(uint256 => Exit) public exits;
    mapping(uint256 => Batch) public batches;
    mapping(uint256 => bool) public refundInitialized;
    mapping(uint256 => uint256) public refundUnitsRemaining;
    uint256 public activeWeth;
    uint256 public collateralUnits;
    uint256 public localUsdc;
    uint256 public reservedWeth;
    uint256 public earnedShares;
    uint256 public lockedShares;
    bool public borrowedThisCycle;
    bytes32 private flashContext;
    bool private flashSeen;
    uint256 private flashCashBefore;
    error WrongState();
    error InvalidConfiguration();
    error Unauthorized();
    error InexactMovement();
    error RiskBound();
    event EntryRequested(uint256 indexed id, address indexed owner, uint256 indexed batch, uint256 weth, uint256 units);
    event ExitRequested(uint256 indexed id, address indexed owner, uint256 indexed batch, uint256 shares);
    event BatchSealed(uint256 indexed batch, uint256 entryUnits, uint256 exitShares);
    event BatchSettled(uint256 indexed batch, uint256 oldAssets, uint256 oldSupply, uint256 entryAssets, uint256 mintedShares, uint256 exitAssets);
    event Claimed(uint256 indexed request, address indexed receiver, uint256 amount, bool entry, bool cash, bool nativeEther);
    event Leveraged(uint256 collateral, uint256 debt, uint256 reserve, uint256 deployed);
    event DebtRepaid(uint256 amount);
    event Defended(uint256 repaid, uint256 wethSpent, uint256 premium);
    event CollateralLoss(uint256 units);
    event EntriesAborted(uint256 indexed batch);
    event DustConverted(uint256 usdc, uint256 weth, address indexed buyer);

    constructor(Configuration memory c, Risk memory r, string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        if (block.chainid != c.expectedChain || address(c.weth).code.length == 0 || address(c.usdc).code.length == 0 ||
            address(c.variableDebt).code.length == 0 || address(c.router).code.length == 0 || address(c.prices).code.length == 0 ||
            c.aWeth.UNDERLYING_ASSET_ADDRESS() != address(c.weth) || c.aWeth.POOL() != address(c.pool) ||
            IScaledToken(address(c.variableDebt)).UNDERLYING_ASSET_ADDRESS() != address(c.usdc) || IScaledToken(address(c.variableDebt)).POOL() != address(c.pool) ||
            IERC20Metadata(address(c.usdc)).decimals() != 6 || IERC20Metadata(address(c.weth)).decimals() != 18 ||
            r.borrowBps > 5000 || r.reserveBps > BPS || r.minimumHealth <= r.defenseHealth || r.defenseHealth <= 1e18 ||
            r.slippageBps > 200 || r.flashPremiumBps > 100 || r.period < 1 hours || r.period > 365 days || r.minimumDeposit == 0 || r.maxDebt == 0) revert InvalidConfiguration();
        weth = c.weth; usdc = c.usdc; pool = c.pool; aWeth = c.aWeth; variableDebt = c.variableDebt;
        router = c.router; prices = c.prices; swapFee = c.swapFee; risk = r;
        waiting = new WaitingEscrow(IERC20(address(c.weth)), c.pool, c.aWeth, address(this));
        position = new ServicePosition(c.usdc, c.service, c.kind, address(this));
        batches[1].entryStart = 1; batches[1].exitStart = 1; nextSealAt = block.timestamp;
    }
    receive() external payable { if (msg.sender != address(weth)) revert Unauthorized(); }
    function _receiver(address receiver) private view {
        if (receiver == address(0) || receiver == address(this) || receiver == address(waiting) || receiver == address(position)) revert WrongState();
    }
    function _entryOwner(Entry storage e) private view { if (e.owner == address(0) || msg.sender != e.owner) revert Unauthorized(); }
    function _exitOwner(Exit storage e) private view { if (e.owner == address(0) || msg.sender != e.owner) revert Unauthorized(); }
    function getBatch(uint256 id) external view returns (Batch memory) { return batches[id]; }
    function debt() public view returns (uint256) { return variableDebt.balanceOf(address(this)); }
    function health() public view returns (uint256 h) { (,,,,, h) = pool.getUserAccountData(address(this)); }

    function requestDeposit(uint256 amount, address owner, bool nativeEther) external payable nonReentrant returns (uint256 id) {
        _receiver(owner); if (phase == Phase.Terminal || position.upstreamStopped() || amount < risk.minimumDeposit) revert WrongState();
        uint256 beforeCash = weth.balanceOf(address(waiting));
        if (nativeEther) {
            if (msg.value != amount) revert WrongState(); weth.deposit{value: amount}(); IERC20(address(weth)).safeTransfer(address(waiting), amount);
        } else {
            if (msg.value != 0) revert WrongState(); IERC20(address(weth)).safeTransferFrom(msg.sender, address(waiting), amount);
        }
        if (weth.balanceOf(address(waiting)) - beforeCash != amount) revert InexactMovement();
        uint256 units = waiting.supply(amount); id = nextEntry++;
        entries[id] = Entry(owner, openBatch, units, 0, false, false); batches[openBatch].entryUnits += units;
        emit EntryRequested(id, owner, openBatch, amount, units);
    }
    function cancelEntry(uint256 id) external {
        Entry storage e = entries[id]; _entryOwner(e);
        if (e.batch != openBatch || e.cancelled || e.claimed) revert WrongState();
        e.cancelled = true; batches[openBatch].entryUnits -= e.units;
    }
    function claimCancelledEntry(uint256 id, address receiver, bool inKind) external nonReentrant returns (uint256 amount) {
        Entry storage e = entries[id]; _entryOwner(e); _receiver(receiver);
        if (!e.cancelled || e.units == 0) revert WrongState();
        uint256 burned;
        if (inKind) (burned, amount) = waiting.retrieveInKind(e.units, receiver);
        else { (burned, amount) = waiting.retrieve(e.units, type(uint256).max); IERC20(address(weth)).safeTransfer(receiver, amount); }
        e.units -= burned;
    }
    function requestRedeem(uint256 shares, address owner) external nonReentrant returns (uint256 id) {
        _receiver(owner); if (phase == Phase.Terminal || shares == 0) revert WrongState();
        _transfer(msg.sender, address(this), shares); lockedShares += shares;
        id = nextExit++; exits[id] = Exit(owner, openBatch, shares, 0, false); batches[openBatch].exitShares += shares;
        emit ExitRequested(id, owner, openBatch, shares);
    }
    function cancelExit(uint256 id, address receiver) external nonReentrant {
        Exit storage e = exits[id]; _exitOwner(e); _receiver(receiver);
        if (e.batch != openBatch || e.shares == 0 || e.claimed) revert WrongState();
        uint256 shares = e.shares; e.shares = 0; batches[openBatch].exitShares -= shares; lockedShares -= shares;
        _transfer(address(this), receiver, shares);
    }
    // @cc [label:accounting] sealed-realization
    // A deterministic seal MUST retain old exposure for all incumbents and isolate every entrant until full actual closure.
    function seal() external nonReentrant {
        Batch storage b = batches[openBatch];
        if (phase != Phase.Running || block.timestamp < nextSealAt || (b.entryUnits == 0 && b.exitShares == 0)) revert WrongState();
        _seal();
    }
    function emergencySeal() external nonReentrant {
        if (phase != Phase.Running) revert WrongState();
        bool unsafe = position.upstreamStopped() || (debt() != 0 && health() < risk.defenseHealth);
        try prices.prices() returns (uint256, uint256) {} catch { unsafe = true; }
        if (!unsafe || (collateralUnits == 0 && debt() == 0 && position.closed())) revert WrongState();
        _seal();
    }
    function _seal() private {
        Batch storage b = batches[openBatch];
        phase = Phase.Draining; sealedBatch = openBatch++;
        b.sealedAt = block.timestamp;
        b.entryEnd = nextEntry; b.exitEnd = nextExit; b.entryCursor = b.entryStart; b.exitCursor = b.exitStart;
        batches[openBatch].entryStart = nextEntry; batches[openBatch].exitStart = nextExit;
        position.beginDrain(); emit BatchSealed(sealedBatch, b.entryUnits, b.exitShares);
    }
    function prepare(uint256 maxWork) external {
        if (phase != Phase.Draining || maxWork == 0 || maxWork > MAX_WORK) revert WrongState();
        Batch storage b = batches[sealedBatch]; uint256 work;
        while (b.entryCursor < b.entryEnd && work++ < maxWork) {
            Entry storage e = entries[b.entryCursor++]; if (e.cancelled) continue;
            e.start = b.preparedUnits; b.preparedUnits += e.units;
        }
        while (b.exitCursor < b.exitEnd && work++ < maxWork) {
            Exit storage e = exits[b.exitCursor++]; e.start = b.preparedShares; b.preparedShares += e.shares;
        }
    }
    function retrieveEntries() external nonReentrant {
        Batch storage b = batches[sealedBatch];
        if (phase != Phase.Draining || b.refundReserved || b.entryCursor != b.entryEnd || b.retrievedUnits == b.entryUnits) revert WrongState();
        (uint256 burned, uint256 amount) = waiting.retrieve(b.entryUnits - b.retrievedUnits, type(uint256).max);
        b.retrievedUnits += burned; b.entryCash += amount;
    }
    /// @notice A stalled incumbent unwind cannot hold isolated entrants forever. Abort the entire sealed entry group after its fixed timeout.
    function abortEntries() external {
        Batch storage b = batches[sealedBatch];
        if (phase != Phase.Draining || b.entriesAborted || b.entryUnits == 0 || b.entryCursor != b.entryEnd ||
            block.timestamp < b.sealedAt + Math.max(2 * risk.period, 2 days)) revert WrongState();
        b.entriesAborted = true; b.refundEntries = true; emit EntriesAborted(sealedBatch);
    }
    function releaseAbortedEntries() external {
        Batch storage b = batches[sealedBatch];
        if (!b.entriesAborted || b.refundReserved || b.retrievedUnits != b.entryUnits) revert WrongState();
        b.refundReserved = true; reservedWeth += b.entryCash;
    }
    /// @notice Fix a mixed WETH/aWETH refund if the isolated waiting reserve cannot return underlying WETH.
    function releaseAbortedInKind() external {
        Batch storage b = batches[sealedBatch];
        if (!b.entriesAborted || b.refundReserved) revert WrongState();
        b.refundReserved = true; b.inKindRefund = true; b.refundUnits = b.entryUnits - b.retrievedUnits;
        reservedWeth += b.entryCash;
    }
    function claimAbortedInKind(uint256 id, address receiver, bool includeLenderToken) external nonReentrant returns (uint256 cash, uint256 lenderTokenAmount) {
        Entry storage e = entries[id]; _entryOwner(e); _receiver(receiver); Batch storage b = batches[e.batch];
        if (!b.inKindRefund || e.cancelled || e.claimed) revert WrongState();
        if (!refundInitialized[id]) {
            refundInitialized[id] = true;
            refundUnitsRemaining[id] = _interval(b.refundUnits, e.start, e.units, b.entryUnits);
            cash = _interval(b.entryCash, e.start, e.units, b.entryUnits); reservedWeth -= cash;
        }
        uint256 units = refundUnitsRemaining[id];
        if (units != 0 && includeLenderToken) {
            uint256 burned; (burned, lenderTokenAmount) = waiting.retrieveInKind(units, receiver);
            refundUnitsRemaining[id] -= burned;
        }
        e.claimed = refundUnitsRemaining[id] == 0;
        if (cash != 0) IERC20(address(weth)).safeTransfer(receiver, cash);
        emit Claimed(id, receiver, cash, true, true, false);
    }
    function collectDownstream() external nonReentrant returns (uint256 amount) {
        uint256 beforeCash = usdc.balanceOf(address(this)); amount = position.returnCash();
        if (usdc.balanceOf(address(this)) - beforeCash != amount) revert InexactMovement(); localUsdc += amount;
    }
    function repayCash() external nonReentrant returns (uint256) { return _repayCash(); }
    function _repayCash() private returns (uint256 paid) {
        uint256 amount = Math.min(localUsdc, debt()); if (amount == 0) return 0;
        uint256 beforeCash = usdc.balanceOf(address(this)); usdc.forceApprove(address(pool), amount);
        paid = pool.repay(address(usdc), amount, 2, address(this)); usdc.forceApprove(address(pool), 0);
        if (paid > amount || beforeCash - usdc.balanceOf(address(this)) != paid) revert InexactMovement();
        localUsdc -= paid; emit DebtRepaid(paid);
    }
    function _reconcileCollateral() private {
        uint256 actual = aWeth.scaledBalanceOf(address(this));
        if (actual < collateralUnits) { emit CollateralLoss(collateralUnits - actual); collateralUnits = actual; }
    }
    function _supply(uint256 amount) private {
        if (amount == 0) return;
        uint256 beforeUnits = aWeth.scaledBalanceOf(address(this)); uint256 beforeCash = weth.balanceOf(address(this));
        IERC20(address(weth)).forceApprove(address(pool), amount); pool.supply(address(weth), amount, address(this), 0);
        IERC20(address(weth)).forceApprove(address(pool), 0);
        uint256 units = aWeth.scaledBalanceOf(address(this)) - beforeUnits;
        if (units == 0 || beforeCash - weth.balanceOf(address(this)) != amount) revert InexactMovement();
        collateralUnits += units;
    }
    function _withdrawCollateral(uint256 amount) private returns (uint256 received) {
        _reconcileCollateral();
        uint256 beforeUnits = aWeth.scaledBalanceOf(address(this)); uint256 beforeCash = weth.balanceOf(address(this));
        received = pool.withdraw(address(weth), amount, address(this));
        uint256 burned = beforeUnits - aWeth.scaledBalanceOf(address(this));
        if (burned == 0 || burned > collateralUnits || received != amount || weth.balanceOf(address(this)) - beforeCash != received) revert InexactMovement();
        collateralUnits -= burned;
    }
    function retrieveCollateral() external nonReentrant {
        if (phase != Phase.Draining || debt() != 0) revert WrongState(); _reconcileCollateral();
        if (collateralUnits == 0) return;
        uint256 amount = Math.mulDiv(collateralUnits, pool.getReserveNormalizedIncome(address(weth)), RAY);
        activeWeth += _withdrawCollateral(amount);
    }
    /// @notice One conservative borrowing decision per realization cycle; defense never automatically reborrows.
    function leverage() external nonReentrant {
        if (phase != Phase.Running || position.upstreamStopped() || borrowedThisCycle || activeWeth == 0 || debt() != 0 || !position.closed()) revert WrongState();
        borrowedThisCycle = true; position.beginCycle();
        uint256 supplied = activeWeth; activeWeth = 0; _supply(supplied); pool.setUserUseReserveAsCollateral(address(weth), true);
        uint256 amount = Math.min(Math.mulDiv(prices.ethToUsdc(supplied), risk.borrowBps, BPS), risk.maxDebt);
        if (amount == 0) { emit Leveraged(supplied, 0, 0, 0); return; }
        uint256 beforeCash = usdc.balanceOf(address(this)); pool.borrow(address(usdc), amount, 2, 0, address(this));
        if (usdc.balanceOf(address(this)) - beforeCash != amount || health() < risk.minimumHealth) revert RiskBound();
        uint256 reserve = Math.mulDiv(amount, risk.reserveBps, BPS, Math.Rounding.Ceil);
        localUsdc += reserve; uint256 deployed = amount - reserve;
        if (deployed != 0) {
            usdc.forceApprove(address(position), deployed); position.allocate(deployed); usdc.forceApprove(address(position), 0);
        }
        emit Leveraged(supplied, amount, reserve, deployed);
    }
    /// @notice Drain surplus into actual WETH with an on-chain fresh-feed slippage floor.
    function convertSurplus() external nonReentrant returns (uint256 amount) {
        if (phase != Phase.Draining || debt() != 0 || localUsdc == 0) revert WrongState();
        uint256 input = localUsdc; localUsdc = 0;
        uint256 minimum = Math.mulDiv(prices.usdcToEth(input, Math.Rounding.Floor), BPS - risk.slippageBps, BPS);
        if (minimum == 0) revert RiskBound();
        uint256 beforeWeth = weth.balanceOf(address(this)); uint256 beforeUsdc = usdc.balanceOf(address(this));
        usdc.forceApprove(address(router), input);
        amount = router.exactInputSingle(ISwapRouter02.ExactInputSingleParams(address(usdc), address(weth), swapFee, address(this), input, minimum, 0));
        usdc.forceApprove(address(router), 0);
        if (amount < minimum || weth.balanceOf(address(this)) - beforeWeth != amount || beforeUsdc - usdc.balanceOf(address(this)) != input) revert InexactMovement();
        activeWeth += amount;
    }
    /// @notice Settle sub-USDC swap dust at the current oracle ratio, paid in real WETH by any willing caller.
    function buyDust(uint256 maxUsdc, uint256 maxWeth) external nonReentrant returns (uint256 input, uint256 paid) {
        input = localUsdc;
        if (phase != Phase.Draining || debt() != 0 || input == 0 || input > 1e6 || input > maxUsdc) revert WrongState();
        paid = prices.usdcToEth(input, Math.Rounding.Ceil); if (paid == 0 || paid > maxWeth) revert RiskBound();
        localUsdc = 0; activeWeth += paid;
        uint256 beforeWeth = weth.balanceOf(address(this));
        IERC20(address(weth)).safeTransferFrom(msg.sender, address(this), paid);
        if (weth.balanceOf(address(this)) - beforeWeth != paid) revert InexactMovement();
        usdc.safeTransfer(msg.sender, input); emit DustConverted(input, paid, msg.sender);
    }

    // @cc [label:security] local-debt-defense
    // Collateral sale MUST be local, price-bounded, repay actual debt and improve health; it MUST NOT rely on a remote return arriving.
    function defendWithFlash(uint256 amount, uint256 maxWeth) external nonReentrant {
        _repayCash(); uint256 beforeHealth = health();
        if (phase == Phase.Terminal || amount == 0 || (amount < 1e6 && amount != debt()) || amount > debt() ||
            (phase == Phase.Running && beforeHealth >= risk.defenseHealth)) revert WrongState();
        uint256 maxDue = amount + Math.mulDiv(amount, risk.flashPremiumBps, BPS, Math.Rounding.Ceil);
        uint256 oracleCap = Math.mulDiv(prices.usdcToEth(maxDue, Math.Rounding.Ceil), BPS, BPS - risk.slippageBps, Math.Rounding.Ceil);
        if (maxWeth == 0 || maxWeth > oracleCap) revert RiskBound();
        bytes memory params = abi.encode(amount, maxWeth);
        flashContext = keccak256(params); flashSeen = false; flashCashBefore = usdc.balanceOf(address(this));
        pool.flashLoanSimple(address(this), address(usdc), amount, params, 0);
        usdc.forceApprove(address(pool), 0);
        if (!flashSeen || usdc.balanceOf(address(this)) != flashCashBefore || (debt() != 0 && health() <= beforeHealth)) revert RiskBound();
        flashContext = bytes32(0); flashSeen = false;
    }
    function executeOperation(address token_, uint256 amount, uint256 premium, address initiator, bytes calldata params) external returns (bool) {
        if (msg.sender != address(pool) || initiator != address(this) || token_ != address(usdc) || flashContext == bytes32(0) ||
            flashSeen || keccak256(params) != flashContext) revert Unauthorized();
        (uint256 expected, uint256 maxWeth) = abi.decode(params, (uint256, uint256));
        if (amount != expected || premium > Math.mulDiv(amount, risk.flashPremiumBps, BPS, Math.Rounding.Ceil) ||
            usdc.balanceOf(address(this)) != flashCashBefore + amount) revert RiskBound();
        flashSeen = true;
        usdc.forceApprove(address(pool), amount);
        if (pool.repay(address(usdc), amount, 2, address(this)) != amount) revert InexactMovement();
        usdc.forceApprove(address(pool), 0);
        uint256 withdrawn = _withdrawCollateral(maxWeth);
        uint256 beforeWeth = weth.balanceOf(address(this)); uint256 beforeUsdc = usdc.balanceOf(address(this));
        IERC20(address(weth)).forceApprove(address(router), withdrawn);
        uint256 spent = router.exactOutputSingle(ISwapRouter02.ExactOutputSingleParams(address(weth), address(usdc), swapFee, address(this), amount + premium, withdrawn, 0));
        IERC20(address(weth)).forceApprove(address(router), 0);
        if (spent > withdrawn || beforeWeth - weth.balanceOf(address(this)) != spent || usdc.balanceOf(address(this)) - beforeUsdc != amount + premium) revert InexactMovement();
        _supply(withdrawn - spent);
        usdc.forceApprove(address(pool), amount + premium); emit Defended(amount, spent, premium); return true;
    }

    function settle() external nonReentrant {
        Batch storage b = batches[sealedBatch];
        _reconcileCollateral();
        if (phase != Phase.Draining || b.entryCursor != b.entryEnd || b.exitCursor != b.exitEnd ||
            b.preparedUnits != b.entryUnits || b.preparedShares != b.exitShares || (!b.inKindRefund && b.retrievedUnits != b.entryUnits) ||
            !position.closed() || debt() != 0 || collateralUnits != 0 || localUsdc != 0) revert WrongState();
        uint256 assets = activeWeth; uint256 supply = totalSupply(); uint256 entered = b.entryCash;
        if (b.exitShares > supply) revert InexactMovement();
        if (supply != 0 && assets == 0) {
            phase = Phase.Terminal; b.refundEntries = true;
        } else {
            b.exitCash = supply == 0 ? 0 : Math.mulDiv(b.exitShares, assets, supply);
            b.mintedShares = b.entriesAborted ? 0 : (supply == 0 ? entered : Math.mulDiv(entered, supply, assets));
            b.refundEntries = b.entriesAborted || (entered != 0 && b.mintedShares == 0);
            phase = Phase.Running;
        }
        activeWeth = assets - b.exitCash + (b.refundEntries ? 0 : entered);
        reservedWeth += b.exitCash + (b.refundEntries && !b.refundReserved ? entered : 0);
        if (b.refundEntries) b.refundReserved = true;
        _burn(address(this), b.exitShares); lockedShares -= b.exitShares;
        _mint(address(this), b.mintedShares); earnedShares += b.mintedShares;
        b.settled = true; borrowedThisCycle = false; nextSealAt = block.timestamp + risk.period;
        emit BatchSettled(sealedBatch, assets, supply, entered, b.mintedShares, b.exitCash);
    }
    function _interval(uint256 output, uint256 start, uint256 amount, uint256 denominator) private pure returns (uint256) {
        return Math.mulDiv(output, start + amount, denominator) - Math.mulDiv(output, start, denominator);
    }
    function _pay(uint256 amount, address receiver, bool unwrap) private returns (bool nativeEther) {
        if (amount == 0) return false;
        if (unwrap) {
            weth.withdraw(amount); (nativeEther,) = receiver.call{value: amount, gas: 30_000}("");
            if (!nativeEther) weth.deposit{value: amount}();
        }
        if (!nativeEther) IERC20(address(weth)).safeTransfer(receiver, amount);
    }
    function claimEntry(uint256 id, address receiver, bool unwrap) external nonReentrant returns (uint256 amount) {
        Entry storage e = entries[id]; _entryOwner(e); _receiver(receiver); Batch storage b = batches[e.batch];
        if (b.inKindRefund || (!b.settled && !(b.entriesAborted && b.refundReserved)) || e.cancelled || e.claimed) revert WrongState(); e.claimed = true;
        bool nativeEther;
        if (b.refundEntries) {
            amount = _interval(b.entryCash, e.start, e.units, b.entryUnits); reservedWeth -= amount; nativeEther = _pay(amount, receiver, unwrap);
        } else {
            amount = _interval(b.mintedShares, e.start, e.units, b.entryUnits); earnedShares -= amount; _transfer(address(this), receiver, amount);
        }
        emit Claimed(id, receiver, amount, true, b.refundEntries, nativeEther);
    }
    function claimExit(uint256 id, address receiver, bool unwrap) external nonReentrant returns (uint256 amount) {
        Exit storage e = exits[id]; _exitOwner(e); _receiver(receiver); Batch storage b = batches[e.batch];
        if (!b.settled || e.shares == 0 || e.claimed) revert WrongState(); e.claimed = true;
        amount = _interval(b.exitCash, e.start, e.shares, b.exitShares); reservedWeth -= amount;
        bool nativeEther = _pay(amount, receiver, unwrap); emit Claimed(id, receiver, amount, false, true, nativeEther);
    }
    function burnWorthless(uint256 shares) external {
        if (phase != Phase.Terminal || activeWeth != 0) revert WrongState(); _burn(msg.sender, shares);
    }
}
