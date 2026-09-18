// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAavePool, IScaledToken} from "./interfaces/External.sol";

/// @notice Debt-free, immutable lender custody. Its controlling vault owns the per-request ledger.
contract WaitingEscrow {
    using SafeERC20 for IERC20;
    IERC20 public immutable asset;
    IAavePool public immutable pool;
    IScaledToken public immutable aToken;
    address public immutable controller;
    uint256 public ownedUnits;
    uint256 private constant RAY = 1e27;

    error Unauthorized();
    error InvalidConfiguration();
    error InexactMovement();

    constructor(IERC20 asset_, IAavePool pool_, IScaledToken aToken_, address controller_) {
        if (controller_ == address(0) || address(asset_).code.length == 0 ||
            address(pool_).code.length == 0 || address(aToken_).code.length == 0 ||
            aToken_.UNDERLYING_ASSET_ADDRESS() != address(asset_) || aToken_.POOL() != address(pool_)) {
            revert InvalidConfiguration();
        }
        asset = asset_; pool = pool_; aToken = aToken_; controller = controller_;
    }

    modifier onlyController() { if (msg.sender != controller) revert Unauthorized(); _; }

    function assetsForUnits(uint256 units) public view returns (uint256) {
        return Math.mulDiv(units, pool.getReserveNormalizedIncome(address(asset)), RAY);
    }
    function retrievalAmount(uint256 units, uint256 maxAssets) public view returns (uint256) {
        uint256 index = pool.getReserveNormalizedIncome(address(asset));
        uint256 whole = Math.mulDiv(units, index, RAY);
        if (maxAssets >= whole) return whole;
        // First select whole owned scaled units. A one-asset cap must not burn an ownership unit worth two assets.
        return Math.mulDiv(Math.mulDiv(maxAssets, RAY, index), index, RAY);
    }

    // @cc [label:accounting] measured-lender-units
    // Each supply MUST credit only its actual scaled-unit increase. No nominal-principal allocation.
    function supply(uint256 assets) external onlyController returns (uint256 units) {
        uint256 beforeUnits = aToken.scaledBalanceOf(address(this));
        uint256 beforeCash = asset.balanceOf(address(this));
        asset.forceApprove(address(pool), assets);
        pool.supply(address(asset), assets, address(this), 0);
        asset.forceApprove(address(pool), 0);
        units = aToken.scaledBalanceOf(address(this)) - beforeUnits;
        if (units == 0 || beforeCash - asset.balanceOf(address(this)) != assets) revert InexactMovement();
        ownedUnits += units;
    }

    // @cc [label:accounting] owner-limited-retrieval
    // Retrieval MUST debit measured scaled units, never more than this request owns. Failure rolls back all movement.
    function retrieve(uint256 units, uint256 maxAssets) external onlyController returns (uint256 burned, uint256 assets) {
        assets = retrievalAmount(units, maxAssets);
        if (assets == 0 || units > ownedUnits) revert InexactMovement();
        uint256 beforeUnits = aToken.scaledBalanceOf(address(this));
        uint256 beforeCash = asset.balanceOf(controller);
        uint256 returned = pool.withdraw(address(asset), assets, controller);
        burned = beforeUnits - aToken.scaledBalanceOf(address(this));
        if (burned == 0 || burned > units || returned != assets ||
            asset.balanceOf(controller) - beforeCash != assets) revert InexactMovement();
        ownedUnits -= burned;
    }

    /// @notice Optional lender-token recovery, independent of underlying withdrawal liquidity.
    function retrieveInKind(uint256 units, address receiver) external onlyController returns (uint256 burned, uint256 amount) {
        amount = assetsForUnits(units);
        if (amount == 0 || units > ownedUnits || receiver == address(0) || receiver == address(this)) revert InexactMovement();
        uint256 beforeUnits = aToken.scaledBalanceOf(address(this));
        IERC20(address(aToken)).safeTransfer(receiver, amount);
        burned = beforeUnits - aToken.scaledBalanceOf(address(this));
        if (burned == 0 || burned > units) revert InexactMovement();
        ownedUnits -= burned;
    }
}
