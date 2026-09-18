// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
interface IAggregator {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}
/// @notice Fixed ETH/USD and USDC/USD feeds; no keeper-selected quote or route.
contract PriceGuard {
    IAggregator public immutable ethFeed;
    IAggregator public immutable usdcFeed;
    IAggregator public immutable sequencer;
    uint256 public immutable maxAge;
    uint256 public immutable grace;
    uint256 public immutable ethScale;
    uint256 public immutable usdcScale;
    error InvalidOracle();
    constructor(IAggregator eth_, IAggregator usdc_, IAggregator sequencer_, uint256 maxAge_, uint256 grace_) {
        if (address(eth_).code.length == 0 || address(usdc_).code.length == 0 || maxAge_ == 0 ||
            eth_.decimals() > 18 || usdc_.decimals() > 18 ||
            (address(sequencer_) != address(0) && (address(sequencer_).code.length == 0 || grace_ == 0))) revert InvalidOracle();
        ethFeed = eth_; usdcFeed = usdc_; sequencer = sequencer_; maxAge = maxAge_; grace = grace_;
        ethScale = 10 ** eth_.decimals(); usdcScale = 10 ** usdc_.decimals();
    }
    function _price(IAggregator feed) private view returns (uint256) {
        (uint80 round, int256 answer,, uint256 updated, uint80 answered) = feed.latestRoundData();
        if (answer <= 0 || updated == 0 || updated > block.timestamp || block.timestamp - updated > maxAge || answered < round) revert InvalidOracle();
        return uint256(answer);
    }
    function prices() public view returns (uint256 eth, uint256 usdc) {
        if (address(sequencer) != address(0)) {
            (, int256 answer, uint256 started,,) = sequencer.latestRoundData();
            if (answer != 0 || started == 0 || started > block.timestamp || block.timestamp - started <= grace) revert InvalidOracle();
        }
        return (Math.mulDiv(_price(ethFeed), 1e18, ethScale), Math.mulDiv(_price(usdcFeed), 1e18, usdcScale));
    }
    function ethToUsdc(uint256 weiAmount) external view returns (uint256) {
        (uint256 eth, uint256 usdc) = prices();
        return Math.mulDiv(weiAmount, eth, usdc * 1e12);
    }
    function usdcToEth(uint256 units, Math.Rounding rounding) external view returns (uint256) {
        (uint256 eth, uint256 usdc) = prices();
        return Math.mulDiv(units, usdc * 1e12, eth, rounding);
    }
}
