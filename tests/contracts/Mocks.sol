// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

// Independent test doubles of external boundaries, not copies of upstream implementation.
contract MockToken is ERC20 {
    uint8 private immutable scale;
    constructor(uint8 scale_) ERC20("Test token", "TEST") { scale = scale_; }
    function decimals() public view override returns (uint8) { return scale; }
    function mint(address to, uint256 value) external { _mint(to, value); }
    function burn(address from, uint256 value) external { _burn(from, value); }
}
contract MockAToken is ERC20 {
    address public immutable UNDERLYING_ASSET_ADDRESS;
    address public immutable POOL;
    uint256 public index = 1e27;
    bool public roundUp = true;
    constructor(address asset, address pool) ERC20("Test aToken", "aTEST") { UNDERLYING_ASSET_ADDRESS = asset; POOL = pool; }
    function setIndex(uint256 value) external { require(value >= index); index = value; }
    function setRounding(bool value) external { roundUp = value; }
    function scaledBalanceOf(address user) external view returns (uint256) { return super.balanceOf(user); }
    function balanceOf(address user) public view override returns (uint256) { return Math.mulDiv(super.balanceOf(user), index, 1e27); }
    function mint(address user, uint256 assets) external { require(msg.sender == POOL); _mint(user, Math.mulDiv(assets, 1e27, index)); }
    function burn(address user, uint256 assets) external {
        require(msg.sender == POOL);
        _burn(user, Math.mulDiv(assets, 1e27, index, roundUp ? Math.Rounding.Ceil : Math.Rounding.Floor));
    }
    function donateUnits(address user, uint256 units) external { _mint(user, units); }
    function transfer(address to, uint256 assets) public override returns (bool) {
        _transfer(msg.sender, to, Math.mulDiv(assets, 1e27, index, Math.Rounding.Ceil)); return true;
    }
}
contract MockAave {
    MockToken public immutable asset;
    MockAToken public immutable aToken;
    bool public illiquid;
    bool public shortReturn;
    constructor(MockToken asset_) { asset = asset_; aToken = new MockAToken(address(asset_), address(this)); }
    function setIlliquid(bool value) external { illiquid = value; }
    function setShortReturn(bool value) external { shortReturn = value; }
    function getReserveNormalizedIncome(address token) external view returns (uint256) { require(token == address(asset)); return aToken.index(); }
    function supply(address token, uint256 assets, address beneficiary, uint16) external {
        require(token == address(asset)); asset.transferFrom(msg.sender, address(this), assets); aToken.mint(beneficiary, assets);
    }
    function withdraw(address token, uint256 assets, address receiver) external returns (uint256) {
        require(!illiquid && token == address(asset));
        if (assets == type(uint256).max) assets = aToken.balanceOf(msg.sender);
        aToken.burn(msg.sender, assets); if (shortReturn) --assets;
        asset.mint(receiver, assets); return assets;
    }
}
contract MockNative {
    MockToken public immutable usdc;
    address public immutable jackpotLPManager;
    uint256 public currentDrawingId = 1;
    bool public emergencyMode;
    bool public locked;
    uint256 public lpPoolCap = 1_000_000e6;
    uint256 public estimated;
    mapping(uint256 => uint256) public getDrawingAccumulator;
    struct Position { uint256 shares; uint256 deposit; uint256 depositDraw; uint256 exit; uint256 exitDraw; uint256 cash; }
    mapping(address => Position) public positions;
    constructor(MockToken token) { usdc = token; jackpotLPManager = address(this); getDrawingAccumulator[0] = 1e18; }
    function setCapacity(uint256 cap, uint256 used) external { lpPoolCap = cap; estimated = used; }
    function setLocked(bool value) external { locked = value; }
    function setEmergency(bool value) external { emergencyMode = value; }
    function settle(uint256 accumulator) external { getDrawingAccumulator[currentDrawingId++] = accumulator; locked = false; estimated = 0; }
    function getEstimatedNextDrawingLpPool() external view returns (uint256) { return estimated; }
    function getLPShares(address owner) external view returns (uint256) {
        Position storage p = positions[owner];
        return p.shares + (p.deposit > 0 && p.depositDraw < currentDrawingId ? p.deposit * 1e18 / getDrawingAccumulator[p.depositDraw] : 0);
    }
    function _roll(Position storage p) private {
        if (p.deposit > 0 && p.depositDraw < currentDrawingId) { p.shares += p.deposit * 1e18 / getDrawingAccumulator[p.depositDraw]; p.deposit = 0; }
        if (p.exit > 0 && p.exitDraw < currentDrawingId) { p.cash += p.exit * getDrawingAccumulator[p.exitDraw] / 1e18; p.exit = 0; }
    }
    function lpDeposit(uint256 assets) external {
        require(!emergencyMode && !locked && assets > 0 && estimated + assets <= lpPoolCap);
        Position storage p = positions[msg.sender]; _roll(p);
        usdc.transferFrom(msg.sender, address(this), assets); p.deposit += assets; p.depositDraw = currentDrawingId; estimated += assets;
    }
    function initiateWithdraw(uint256 shares) external {
        require(!emergencyMode && !locked && shares > 0); Position storage p = positions[msg.sender]; _roll(p);
        p.shares -= shares; p.exit += shares; p.exitDraw = currentDrawingId;
    }
    function finalizeWithdraw() external {
        require(!emergencyMode); Position storage p = positions[msg.sender]; _roll(p);
        uint256 cash = p.cash; require(cash > 0); p.cash = 0; usdc.mint(msg.sender, cash);
    }
    function emergencyWithdrawLP() external {
        require(emergencyMode); Position storage p = positions[msg.sender]; _roll(p);
        uint256 accumulator = getDrawingAccumulator[currentDrawingId - 1];
        uint256 cash = p.cash + p.deposit + p.shares * accumulator / 1e18 + p.exit * accumulator / 1e18;
        delete positions[msg.sender]; usdc.mint(msg.sender, cash);
    }
}
