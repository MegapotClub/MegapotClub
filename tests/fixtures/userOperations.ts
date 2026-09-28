import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";

type Log = TransactionReceipt["logs"][number];
export const ENTRY_POINT_V06: Address =
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
export const ENTRY_POINT_V07: Address =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const bundler: Address = "0x4444444444444444444444444444444444444444";
const hash = `0x${"ab".repeat(32)}` as const;
const v06 = parseAbi([
  "function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, uint256 callGasLimit, uint256 verificationGasLimit, uint256 preVerificationGas, uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)",
]);
const v07 = parseAbi([
  "function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)",
]);
const events = parseAbi([
  "event BeforeExecution()",
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
]);
const coinbaseAccount = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);

export type Operation = {
  sender: Address;
  /** Coinbase Smart Wallet calls, or raw account callData in another encoding. */
  calls: { to: Address; data: Hex; value?: bigint }[] | Hex;
  success?: boolean;
  logs?: Log[];
};

function callData(calls: Operation["calls"]): Hex {
  if (typeof calls === "string") return calls;
  return calls.length === 1
    ? encodeFunctionData({
        abi: coinbaseAccount,
        functionName: "execute",
        args: [calls[0].to, calls[0].value ?? 0n, calls[0].data],
      })
    : encodeFunctionData({
        abi: coinbaseAccount,
        functionName: "executeBatch",
        args: [
          calls.map((c) => ({
            target: c.to,
            value: c.value ?? 0n,
            data: c.data,
          })),
        ],
      });
}

/** A synthetic bundler transaction and receipt executing operations in bundle order. */
export function bundle(ops: Operation[], entryPoint = ENTRY_POINT_V06) {
  const shared = ops.map((op, i) => ({
    sender: op.sender,
    nonce: BigInt(i),
    initCode: "0x" as Hex,
    callData: callData(op.calls),
    preVerificationGas: 1n,
    paymasterAndData: "0x" as Hex,
    signature: "0x" as Hex,
  }));
  const input =
    entryPoint === ENTRY_POINT_V06
      ? encodeFunctionData({
          abi: v06,
          functionName: "handleOps",
          args: [
            shared.map((op) => ({
              ...op,
              callGasLimit: 1n,
              verificationGasLimit: 1n,
              maxFeePerGas: 1n,
              maxPriorityFeePerGas: 1n,
            })),
            bundler,
          ],
        })
      : encodeFunctionData({
          abi: v07,
          functionName: "handleOps",
          args: [
            shared.map((op) => ({
              ...op,
              accountGasLimits: zeroHash,
              gasFees: zeroHash,
            })),
            bundler,
          ],
        });
  const fromEntryPoint = (topics: Log["topics"], data: Hex = "0x") =>
    ({ address: entryPoint, topics, data }) as Log;
  const logs = [
    fromEntryPoint(
      encodeEventTopics({
        abi: events,
        eventName: "BeforeExecution",
      }) as Log["topics"],
    ),
    ...ops.flatMap((op, i) => [
      ...(op.logs ?? []),
      fromEntryPoint(
        encodeEventTopics({
          abi: events,
          eventName: "UserOperationEvent",
          args: {
            userOpHash: zeroHash,
            sender: op.sender,
            paymaster: zeroAddress,
          },
        }) as Log["topics"],
        encodeAbiParameters(
          parseAbiParameters("uint256, bool, uint256, uint256"),
          [BigInt(i), op.success ?? true, 1n, 1n],
        ),
      ),
    ]),
  ].map((log, logIndex) => ({
    ...log,
    blockHash: hash,
    blockNumber: 100n,
    transactionHash: hash,
    transactionIndex: 0,
    logIndex,
    removed: false,
  }));
  return {
    tx: { from: bundler, to: entryPoint, input, nonce: 300, value: 0n },
    receipt: {
      status: "success" as const,
      blockNumber: 100n,
      blockHash: hash,
      logs,
    },
  };
}
