// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BaseUsdcVault} from "./BaseUsdcVault.sol";
import {CctpRoute} from "./transport/CctpRoute.sol";

/// @notice Optional separately funded progress tips. Vault assets never fund executor compensation.
contract KeeperBudget is ReentrancyGuard {
    enum Stage { Admit, Exit, Activate, Collect, Recover }
    struct Budget { address owner; uint256 remaining; uint256 tip; uint256 expires; }
    BaseUsdcVault public immutable vault;
    CctpRoute public immutable route;
    mapping(uint256 => Budget) public budgets;
    mapping(address => uint256) public rewards;
    mapping(bytes32 => bool) public rewardedProgress;
    uint256 public nextBudget = 1;
    error InvalidBudget();
    error InvalidTarget();
    error TransferFailed();
    event Funded(uint256 indexed budget, address indexed owner, uint256 amount, uint256 tip, uint256 expires);
    event Rewarded(bytes32 indexed progress, address indexed executor, uint256 indexed budget, uint256 amount);
    event BudgetWithdrawn(uint256 indexed budget, address indexed receiver, uint256 amount);

    constructor(BaseUsdcVault vault_, CctpRoute route_) {
        if ((address(vault_) == address(0) && address(route_) == address(0)) ||
            (address(vault_) != address(0) && address(vault_).code.length == 0) ||
            (address(route_) != address(0) && address(route_).code.length == 0)) revert InvalidTarget();
        vault = vault_; route = route_;
    }
    function fund(uint256 tip, uint256 expires) external payable returns (uint256 id) {
        if (tip == 0 || msg.value < tip || expires <= block.timestamp) revert InvalidBudget();
        id = nextBudget++; budgets[id] = Budget(msg.sender, msg.value, tip, expires); emit Funded(id, msg.sender, msg.value, tip, expires);
    }
    function withdrawBudget(uint256 id, uint256 amount, address payable receiver) external nonReentrant {
        Budget storage b = budgets[id]; if (msg.sender != b.owner || receiver == address(0) || amount > b.remaining) revert InvalidBudget();
        b.remaining -= amount; (bool ok,) = receiver.call{value: amount}(""); if (!ok) revert TransferFailed(); emit BudgetWithdrawn(id, receiver, amount);
    }
    function _credit(uint256 id, bytes32 progress) private {
        if (rewardedProgress[progress]) return;
        Budget storage b = budgets[id];
        if (b.owner == address(0) || b.expires <= block.timestamp || b.remaining < b.tip) return;
        rewardedProgress[progress] = true;
        b.remaining -= b.tip; rewards[msg.sender] += b.tip; emit Rewarded(progress, msg.sender, id, b.tip);
    }
    // @cc [label:security] progress-only-tips
    // Pay only completed economic progress, at most once per draw/stage or authenticated application message. No caller-selected tiny chunks.
    function runVault(Stage stage, uint256 budget) external nonReentrant returns (bool progressed) {
        if (address(vault) == address(0)) revert InvalidTarget();
        uint256 draw = vault.jackpot().currentDrawingId();
        if (stage == Stage.Admit) progressed = vault.processDeposits(vault.MAX_WORK(), type(uint256).max) != 0;
        else if (stage == Stage.Exit) progressed = vault.processRedeems(vault.MAX_WORK(), type(uint256).max) != 0;
        else if (stage == Stage.Activate) {
            draw = vault.pendingDepositDraw(); bool pending = vault.hasPendingDeposit(); vault.syncDeposits(); progressed = pending && !vault.hasPendingDeposit();
        } else if (stage == Stage.Collect) {
            draw = vault.pendingExitDraw(); bool pending = vault.hasPendingExit(); vault.syncExits(); progressed = pending && !vault.hasPendingExit();
        } else {
            vault.recoverNative(); progressed = true;
        }
        if (progressed) _credit(budget, keccak256(abi.encode(address(vault), stage, draw)));
    }
    function relay(bool assetMessage, bytes calldata message, bytes calldata attestation, uint256 budget) external nonReentrant {
        if (address(route) == address(0)) revert InvalidTarget();
        if (assetMessage) route.relayAsset(message, attestation); else route.relayControl(message, attestation);
        bytes32 application = keccak256(assetMessage ? message[376:] : message[148:]);
        _credit(budget, keccak256(abi.encode(address(route), assetMessage, application)));
    }
    function claimReward(address payable receiver) external nonReentrant returns (uint256 amount) {
        if (receiver == address(0)) revert InvalidBudget(); amount = rewards[msg.sender]; rewards[msg.sender] = 0;
        (bool ok,) = receiver.call{value: amount}(""); if (!ok) revert TransferFailed();
    }
}
