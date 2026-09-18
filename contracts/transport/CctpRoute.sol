// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ICctpMessenger {
    function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken,
        bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes calldata hookData) external;
}
interface ICctpTransmitter {
    function sendMessage(uint32 destinationDomain, bytes32 recipient, bytes32 destinationCaller, uint32 minFinalityThreshold, bytes calldata body) external;
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool);
}

/// @notice Finalized, zero-fee CCTP V2 transport for one immutable app pair. No arbitrary hooks.
abstract contract CctpRoute is ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct RouteConfig {
        IERC20 token;
        ICctpMessenger messenger;
        ICctpTransmitter transmitter;
        address peer;
        bytes32 remoteToken;
        bytes32 remoteMessenger;
        uint32 localDomain;
        uint32 remoteDomain;
        uint256 expectedChain;
        uint256 maximumBurn;
    }
    struct Message { uint256 kind; uint256 operation; address owner; uint256 sequence; uint256 amount; uint256 aux; uint256 total; }
    uint256 internal constant DEPOSIT = 1;
    uint256 internal constant RETURN = 2;
    uint256 internal constant ACTIVATE = 3;
    uint256 internal constant EXIT = 4;
    uint256 internal constant REDEEM = 5;
    uint256 internal constant CLOSE = 6;
    uint256 internal constant STOP = 7;
    bytes32 public constant FORMAT = keccak256("Megapot Club CCTP route v1");
    uint32 public constant FINALITY = 2000;
    IERC20 public immutable token;
    ICctpMessenger public immutable messenger;
    ICctpTransmitter public immutable transmitter;
    address public immutable peer;
    bytes32 public immutable remoteToken;
    bytes32 public immutable remoteMessenger;
    uint32 public immutable localDomain;
    uint32 public immutable remoteDomain;
    uint256 public immutable maximumBurn;
    mapping(bytes32 => bool) public assetReceived;
    bytes32 private callbackHash;
    bool private callbackSeen;

    error InvalidRoute();
    error InvalidMessage();
    error Replay();
    error InexactTransport();
    event AssetSent(uint256 indexed kind, uint256 indexed operation, uint256 indexed sequence, uint256 amount);
    event AssetReceived(uint256 indexed kind, uint256 indexed operation, uint256 indexed sequence, uint256 amount);
    event ControlSent(uint256 indexed kind, uint256 indexed operation, uint256 indexed sequence);
    event ControlReceived(uint256 indexed kind, uint256 indexed operation, uint256 indexed sequence);

    constructor(RouteConfig memory c) {
        if (block.chainid != c.expectedChain || c.localDomain == c.remoteDomain || c.peer == address(0) || c.maximumBurn < 1e6 ||
            c.remoteToken == bytes32(0) || c.remoteMessenger == bytes32(0) ||
            address(c.token).code.length == 0 || address(c.messenger).code.length == 0 || address(c.transmitter).code.length == 0) revert InvalidRoute();
        token = c.token; messenger = c.messenger; transmitter = c.transmitter; peer = c.peer;
        remoteToken = c.remoteToken; remoteMessenger = c.remoteMessenger; localDomain = c.localDomain; remoteDomain = c.remoteDomain; maximumBurn = c.maximumBurn;
    }
    function _address(address a) internal pure returns (bytes32) { return bytes32(uint256(uint160(a))); }
    function _encode(Message memory m) internal pure returns (bytes memory) { return abi.encode(FORMAT, m); }
    function _decode(bytes calldata data) private pure returns (Message memory m) {
        if (data.length != 256) revert InvalidMessage();
        bytes32 format;
        (format, m) = abi.decode(data, (bytes32, Message));
        if (format != FORMAT || m.operation == 0 || m.owner == address(0) || m.kind == 0 || m.kind > STOP) revert InvalidMessage();
    }
    function _u32(bytes calldata message, uint256 offset) private pure returns (uint32) { return uint32(bytes4(message[offset:offset + 4])); }
    function _b32(bytes calldata message, uint256 offset) private pure returns (bytes32) { return bytes32(message[offset:offset + 32]); }
    function _header(bytes calldata message, bool assetMessage) private view {
        if (message.length != (assetMessage ? 632 : 404) || _u32(message, 0) != 1 ||
            _u32(message, 4) != remoteDomain || _u32(message, 8) != localDomain ||
            _b32(message, 44) != (assetMessage ? remoteMessenger : _address(peer)) ||
            _b32(message, 76) != (assetMessage ? _address(address(messenger)) : _address(address(this))) ||
            _b32(message, 108) != _address(address(this)) || _u32(message, 140) != FINALITY || _u32(message, 144) < FINALITY) revert InvalidMessage();
    }

    // @cc [label:security] mint-and-credit-atomic
    // Only the fixed attested app may create credit. Mint and exact ownership credit MUST commit together; investment is separate.
    function relayAsset(bytes calldata message, bytes calldata attestation) external nonReentrant {
        _header(message, true);
        if (_u32(message, 148) != 1 || _b32(message, 152) != remoteToken || _b32(message, 184) != _address(address(this)) ||
            _b32(message, 248) != _address(peer) || _b32(message, 280) != bytes32(0) || _b32(message, 312) != bytes32(0)) revert InvalidMessage();
        uint256 expiration = uint256(_b32(message, 344));
        if (expiration != 0 && expiration <= block.number) revert InvalidMessage();
        Message memory m = _decode(message[376:]);
        if ((m.kind != DEPOSIT && m.kind != RETURN) || m.sequence == 0 || m.amount == 0 ||
            m.amount != uint256(_b32(message, 216)) || m.aux != 0 || m.total != 0) revert InvalidMessage();
        bytes32 key = keccak256(abi.encode(m.kind, m.operation, m.sequence));
        if (assetReceived[key]) revert Replay();
        uint256 beforeCash = token.balanceOf(address(this));
        if (!transmitter.receiveMessage(message, attestation) || token.balanceOf(address(this)) - beforeCash != m.amount) revert InexactTransport();
        assetReceived[key] = true;
        _receiveAsset(m);
        emit AssetReceived(m.kind, m.operation, m.sequence, m.amount);
    }
    function relayControl(bytes calldata message, bytes calldata attestation) external nonReentrant {
        _header(message, false);
        callbackHash = keccak256(message[148:]); callbackSeen = false;
        if (!transmitter.receiveMessage(message, attestation) || !callbackSeen) revert InexactTransport();
        callbackHash = bytes32(0); callbackSeen = false;
    }
    function handleReceiveFinalizedMessage(uint32 source, bytes32 sender, uint32 finality, bytes calldata body) external returns (bool) {
        if (msg.sender != address(transmitter) || source != remoteDomain || sender != _address(peer) || finality < FINALITY ||
            callbackHash == bytes32(0) || callbackSeen || keccak256(body) != callbackHash) revert InvalidMessage();
        callbackSeen = true;
        Message memory m = _decode(body);
        if (m.kind < ACTIVATE) revert InvalidMessage();
        _receiveControl(m); emit ControlReceived(m.kind, m.operation, m.sequence); return true;
    }
    function handleReceiveUnfinalizedMessage(uint32, bytes32, uint32, bytes calldata) external pure returns (bool) { revert InvalidMessage(); }

    function _sendAsset(Message memory m) internal {
        if (m.amount == 0 || m.amount > maximumBurn) revert InvalidMessage();
        uint256 beforeCash = token.balanceOf(address(this));
        token.forceApprove(address(messenger), m.amount);
        messenger.depositForBurnWithHook(m.amount, remoteDomain, _address(peer), address(token), _address(peer), 0, FINALITY, _encode(m));
        token.forceApprove(address(messenger), 0);
        if (beforeCash - token.balanceOf(address(this)) != m.amount) revert InexactTransport();
        emit AssetSent(m.kind, m.operation, m.sequence, m.amount);
    }
    function _sendControl(Message memory m) internal {
        transmitter.sendMessage(remoteDomain, _address(peer), _address(peer), FINALITY, _encode(m));
        emit ControlSent(m.kind, m.operation, m.sequence);
    }
    function _receiveAsset(Message memory m) internal virtual;
    function _receiveControl(Message memory m) internal virtual;
}
