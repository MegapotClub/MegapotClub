// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IScaledToken is IERC20 {
    function scaledBalanceOf(address user) external view returns (uint256);
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
    function POOL() external view returns (address);
}

interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referral) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function getReserveNormalizedIncome(address asset) external view returns (uint256);
    function borrow(address asset, uint256 amount, uint256 mode, uint16 referral, address onBehalfOf) external;
    function repay(address asset, uint256 amount, uint256 mode, address onBehalfOf) external returns (uint256);
    function setUserUseReserveAsCollateral(address asset, bool useAsCollateral) external;
    function getUserAccountData(address user) external view returns (
        uint256 collateralBase, uint256 debtBase, uint256 availableBorrowsBase,
        uint256 liquidationThreshold, uint256 ltv, uint256 healthFactor
    );
}

interface INativeJackpot {
    function currentDrawingId() external view returns (uint256);
    function emergencyMode() external view returns (bool);
    function jackpotLPManager() external view returns (address);
    function usdc() external view returns (address);
    function lpDeposit(uint256 assets) external;
    function initiateWithdraw(uint256 shares) external;
    function finalizeWithdraw() external;
    function emergencyWithdrawLP() external;
}

interface INativeLPManager {
    function lpPoolCap() external view returns (uint256);
    function getEstimatedNextDrawingLpPool() external view returns (uint256);
    function getDrawingAccumulator(uint256 draw) external view returns (uint256);
    function getLPShares(address account) external view returns (uint256);
}

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}
