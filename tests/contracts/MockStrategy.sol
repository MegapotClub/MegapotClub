// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {MockToken, MockAToken} from "./Mocks.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISwapRouter02} from "../../contracts/strategy/StrategyInterfaces.sol";
interface IFlashReceiver { function executeOperation(address, uint256, uint256, address, bytes calldata) external returns (bool); }
contract MockWETH is MockToken {
    constructor() MockToken(18) {}
    function deposit() external payable { _mint(msg.sender, msg.value); }
    function withdraw(uint256 amount) external { _burn(msg.sender, amount); (bool ok,) = msg.sender.call{value: amount}(""); require(ok); }
}
contract RejectEther { receive() external payable { revert(); } }
contract MockFeed {
    uint8 public constant decimals = 8;
    int256 public price;
    uint256 public updated;
    uint256 public started;
    constructor(int256 value) { price = value; updated = block.timestamp; started = block.timestamp - 2 hours; }
    function set(int256 value, uint256 timestamp_) external { price = value; updated = timestamp_; }
    function setStarted(uint256 timestamp_) external { started = timestamp_; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) { return (1, price, started, updated, 1); }
}
contract MockLending {
    MockWETH public immutable weth;
    MockToken public immutable usdc;
    MockAToken public immutable aWeth;
    MockAToken public immutable variableDebt;
    uint256 public ethPrice = 2000e8;
    uint256 public premiumBps = 5;
    bool public paused;
    constructor(MockWETH w, MockToken u) { weth = w; usdc = u; aWeth = new MockAToken(address(w), address(this)); variableDebt = new MockAToken(address(u), address(this)); }
    function setPrice(uint256 value) external { ethPrice = value; }
    function setPaused(bool value) external { paused = value; }
    function setPremium(uint256 value) external { premiumBps = value; }
    function accrue(address account, uint256 amount) external { variableDebt.mint(account, amount); }
    function liquidate(address account, uint256 collateral, uint256 repayment) external { aWeth.burn(account, collateral); variableDebt.burn(account, repayment); }
    function getReserveNormalizedIncome(address asset) external view returns (uint256) { require(asset == address(weth)); return aWeth.index(); }
    function supply(address asset, uint256 amount, address owner, uint16) external {
        require(!paused && asset == address(weth)); weth.transferFrom(msg.sender, address(this), amount); aWeth.mint(owner, amount);
    }
    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        require(!paused && asset == address(weth)); aWeth.burn(msg.sender, amount); require(_health(msg.sender) >= 1e18);
        weth.mint(to, amount); return amount;
    }
    function setUserUseReserveAsCollateral(address, bool) external {}
    function borrow(address asset, uint256 amount, uint256 mode, uint16, address owner) external {
        require(!paused && asset == address(usdc) && mode == 2 && owner == msg.sender); variableDebt.mint(owner, amount);
        require(_health(owner) >= 1e18); usdc.mint(msg.sender, amount);
    }
    function repay(address asset, uint256 amount, uint256 mode, address owner) external returns (uint256) {
        require(asset == address(usdc) && mode == 2); amount = Math.min(amount, variableDebt.balanceOf(owner));
        usdc.transferFrom(msg.sender, address(this), amount); variableDebt.burn(owner, amount); return amount;
    }
    function _health(address owner) private view returns (uint256) {
        uint256 debt = variableDebt.balanceOf(owner); if (debt == 0) return type(uint256).max;
        uint256 collateral = Math.mulDiv(aWeth.balanceOf(owner), ethPrice, 1e18);
        return Math.mulDiv(collateral, 8e17, debt * 100);
    }
    function getUserAccountData(address owner) external view returns (uint256, uint256, uint256, uint256, uint256, uint256) {
        return (Math.mulDiv(aWeth.balanceOf(owner), ethPrice, 1e18), variableDebt.balanceOf(owner) * 100, 0, 8000, 7500, _health(owner));
    }
    function flashLoanSimple(address receiver, address asset, uint256 amount, bytes calldata params, uint16) external {
        require(!paused && asset == address(usdc)); uint256 premium = Math.mulDiv(amount, premiumBps, 10000, Math.Rounding.Ceil);
        usdc.mint(receiver, amount); require(IFlashReceiver(receiver).executeOperation(asset, amount, premium, msg.sender, params));
        usdc.transferFrom(receiver, address(this), amount + premium);
    }
}
contract MockRouter is ISwapRouter02 {
    MockToken public immutable usdc;
    MockWETH public immutable weth;
    uint256 public price = 2000e6;
    uint256 public spreadBps;
    constructor(MockToken u, MockWETH w) { usdc = u; weth = w; }
    function setPrice(uint256 value) external { price = value; }
    function setSpread(uint256 value) external { spreadBps = value; }
    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 out) {
        require(p.tokenIn == address(usdc) && p.tokenOut == address(weth));
        out = Math.mulDiv(Math.mulDiv(p.amountIn, 1e18, price), 10000 - spreadBps, 10000); require(out >= p.amountOutMinimum);
        usdc.transferFrom(msg.sender, address(this), p.amountIn); weth.mint(p.recipient, out);
    }
    function exactOutputSingle(ExactOutputSingleParams calldata p) external payable returns (uint256 input) {
        require(p.tokenIn == address(weth) && p.tokenOut == address(usdc));
        input = Math.mulDiv(Math.mulDiv(p.amountOut, 1e18, price, Math.Rounding.Ceil), 10000 + spreadBps, 10000, Math.Rounding.Ceil); require(input <= p.amountInMaximum);
        weth.transferFrom(msg.sender, address(this), input); usdc.mint(p.recipient, p.amountOut);
    }
}
