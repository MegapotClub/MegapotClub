import {
  decodeEventLog,
  decodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";

type Log = TransactionReceipt["logs"][number];
export type AccountCall = { to: Address; input: Hex; value: bigint };
export type AccountOperation = {
  calls: AccountCall[];
  success: boolean;
  logs: Log[];
};

/** Canonical ERC-4337 EntryPoint v0.6, v0.7 and v0.8 deployments. */
const ENTRY_POINTS = [
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
].map((address) => address.toLowerCase());
const entryPointAbi = parseAbi([
  "function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)",
  "function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)",
  "event BeforeExecution()",
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
]);
// Coinbase Smart Wallet encodings, including EIP-7702 upgraded Coinbase accounts.
const accountAbi = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);

function operations(tx: { to: Address | null; input: Hex }) {
  if (!tx.to || !ENTRY_POINTS.includes(tx.to.toLowerCase())) return [];
  try {
    const decoded = decodeFunctionData({ abi: entryPointAbi, data: tx.input });
    return decoded.args[0].map((op) => ({
      sender: op.sender,
      nonce: op.nonce,
      calls: accountCalls(op.callData),
    }));
  } catch {
    return [];
  }
}
function accountCalls(callData: Hex): AccountCall[] {
  try {
    const decoded = decodeFunctionData({ abi: accountAbi, data: callData });
    return decoded.functionName === "execute"
      ? [
          {
            to: decoded.args[0],
            value: decoded.args[1],
            input: decoded.args[2],
          },
        ]
      : decoded.args[0].map((call) => ({
          to: call.target,
          value: call.value,
          input: call.data,
        }));
  } catch {
    return [];
  }
}

/** Calls a direct EntryPoint bundle carries for the account, before its receipt is known. */
export function bundledCalls(
  tx: { to: Address | null; input: Hex },
  account: string,
): AccountCall[] {
  return operations(tx)
    .filter((op) => op.sender.toLowerCase() === account.toLowerCase())
    .flatMap((op) => op.calls);
}

/** @cc [label:security] bundled-account-effect
 * A wallet may execute a reviewed call as an ERC-4337 operation for the connected account.
 * Such a bundle MUST count only through a decoded operation whose sender is that account and
 * whose own EntryPoint event reports the outcome. Receipt evidence MUST come from that
 * operation's logs alone, never from another operation in the same bundle.
 */
export function accountOperations(
  tx: { to: Address | null; input: Hex },
  receipt: { logs: Log[] },
  account: string,
): AccountOperation[] {
  const ops = operations(tx);
  if (!ops.length) return [];
  const results: {
    sender: Address;
    nonce: bigint;
    success: boolean;
    logs: Log[];
  }[] = [];
  let start = 0;
  receipt.logs.forEach((log, index) => {
    if (log.address.toLowerCase() !== tx.to!.toLowerCase()) return;
    let event;
    try {
      event = decodeEventLog({
        abi: entryPointAbi,
        data: log.data,
        topics: log.topics,
      });
    } catch {
      return;
    }
    if (event.eventName === "UserOperationEvent")
      results.push({
        sender: event.args.sender,
        nonce: event.args.nonce,
        success: event.args.success,
        logs: receipt.logs.slice(start, index),
      });
    start = index + 1;
  });
  // Operations execute in bundle order. Any mismatch leaves the bundle unattributed.
  if (
    results.length !== ops.length ||
    results.some(
      (result, i) =>
        result.sender.toLowerCase() !== ops[i].sender.toLowerCase() ||
        result.nonce !== ops[i].nonce,
    )
  )
    return [];
  return ops.flatMap((op, i) =>
    op.sender.toLowerCase() === account.toLowerCase()
      ? [
          {
            calls: op.calls,
            success: results[i].success,
            logs: results[i].logs,
          },
        ]
      : [],
  );
}
