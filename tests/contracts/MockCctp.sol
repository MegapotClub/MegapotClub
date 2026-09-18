// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
import {MockToken} from "./Mocks.sol";
interface IMessageHandler {
    function handleReceiveFinalizedMessage(uint32, bytes32, uint32, bytes calldata) external returns (bool);
}
contract MockTransmitter {
    uint32 public immutable domain;
    MockToken public immutable token;
    address public messenger;
    bool public shortMint;
    bytes[] public sent;
    mapping(bytes32 => bool) public used;
    constructor(uint32 domain_, MockToken token_) { domain = domain_; token = token_; }
    function setMessenger(address m) external { messenger = m; }
    function setShortMint(bool v) external { shortMint = v; }
    function sentCount() external view returns (uint256) { return sent.length; }
    function sendMessage(uint32 destination, bytes32 recipient, bytes32 caller, uint32 finality, bytes calldata body) external {
        sent.push(abi.encodePacked(uint32(1), domain, destination, bytes32(0), bytes32(uint256(uint160(msg.sender))), recipient, caller, finality, uint32(0), body));
    }
    function receiveMessage(bytes calldata m, bytes calldata attestation) external returns (bool) {
        require(m.length >= 148 && keccak256(m) == abi.decode(attestation, (bytes32)), "attestation");
        require(uint32(bytes4(m[8:12])) == domain && bytes32(m[108:140]) == bytes32(uint256(uint160(msg.sender))), "route");
        bytes32 nonce = bytes32(m[12:44]); require(!used[nonce], "nonce"); used[nonce] = true;
        address recipient = address(uint160(uint256(bytes32(m[76:108]))));
        if (recipient == messenger) {
            uint256 amount = uint256(bytes32(m[216:248])); if (shortMint) --amount;
            token.mint(address(uint160(uint256(bytes32(m[184:216])))), amount);
        } else {
            require(IMessageHandler(recipient).handleReceiveFinalizedMessage(uint32(bytes4(m[4:8])), bytes32(m[44:76]), uint32(bytes4(m[144:148])), m[148:]), "callback");
        }
        return true;
    }
}
contract MockMessenger {
    MockTransmitter public immutable transmitter;
    constructor(MockTransmitter t) { transmitter = t; }
    function depositForBurnWithHook(uint256 amount, uint32 destination, bytes32 recipient, address token, bytes32 caller,
        uint256 maxFee, uint32 finality, bytes calldata hook) external {
        require(maxFee == 0 && finality == 2000);
        MockToken(token).transferFrom(msg.sender, address(this), amount); MockToken(token).burn(address(this), amount);
        // The real messenger chooses its registered peer; the harness uses the paired mock's configured address.
        transmitter.sendMessage(destination, remoteMessenger, caller, finality,
            abi.encodePacked(uint32(1), bytes32(uint256(uint160(token))), recipient, amount, bytes32(uint256(uint160(msg.sender))), maxFee, uint256(0), uint256(0), hook));
    }
    bytes32 public remoteMessenger;
    function setRemote(bytes32 remote) external { remoteMessenger = remote; }
}
