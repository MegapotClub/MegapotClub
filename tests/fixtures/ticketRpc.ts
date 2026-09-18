import { decodeFunctionData, encodeFunctionResult, parseAbi } from "viem";
import { multicallResult } from "./multicall.ts";
export const fixtureAddress = "0x1111111111111111111111111111111111111111";
export const alternateAddress = "0x2222222222222222222222222222222222222222";
export const fixtureAbi = parseAbi([
  "function currentDrawingId() view returns (uint256)",
  "function getUserTickets(address, uint256) view returns ((uint256 ticketId, (uint256 drawingId, uint256 packedTicket, bytes32 referralScheme) ticket, uint8[] normals, uint8 bonusball)[])",
  "function getDrawingState(uint256) view returns ((uint256 prizePool, uint256 ticketPrice, uint256 edgePerTicket, uint256 referralWinShare, uint256 referralFee, uint256 globalTicketsBought, uint256 lpEarnings, uint256 drawingTime, uint256 winningTicket, uint8 ballMax, uint8 bonusballMax, address payoutCalculator, bool jackpotLock))",
  "function getUnpackedTicket(uint256, uint256) view returns (uint8[] normals, uint8 bonusball)",
]);
export type RpcRequest = { id: number; method: string; params: unknown[] };
export function ticketRpc(
  request: RpcRequest,
  timestamp = Math.floor(Date.now() / 1000),
  count = 5,
) {
  const aggregate = multicallResult(request, (inner) =>
    ticketRpc(inner, timestamp, count),
  );
  if (aggregate) return { jsonrpc: "2.0", id: request.id, result: aggregate };
  let result: unknown;
  if (request.method === "eth_chainId") result = "0x2105";
  else if (request.method === "eth_getCode") result = "0x6000";
  else if (request.method === "eth_getBlockByNumber")
    result = {
      number: "0x1234567",
      hash: `0x${"11".repeat(32)}`,
      timestamp: `0x${timestamp.toString(16)}`,
      transactions: [],
    };
  else if (request.method === "eth_call") {
    const { functionName, args } = decodeFunctionData({
      abi: fixtureAbi,
      data: (request.params[0] as { data: `0x${string}` }).data,
    });
    if (functionName === "currentDrawingId")
      result = encodeFunctionResult({
        abi: fixtureAbi,
        functionName,
        result: 175n,
      });
    else if (functionName === "getDrawingState")
      result = encodeFunctionResult({
        abi: fixtureAbi,
        functionName,
        result: {
          prizePool: 1000000000n,
          ticketPrice: 1000000n,
          edgePerTicket: 0n,
          referralWinShare: 0n,
          referralFee: 0n,
          globalTicketsBought: 1000n,
          lpEarnings: 0n,
          drawingTime: BigInt(timestamp + 3600) - (175n - args[0]) * 86400n,
          winningTicket: args[0] < 175n ? 1n : 0n,
          ballMax: 30,
          bonusballMax: 10,
          payoutCalculator: "0x0000000000000000000000000000000000000001",
          jackpotLock: args[0] < 175n,
        },
      });
    else if (functionName === "getUnpackedTicket")
      result = encodeFunctionResult({
        abi: fixtureAbi,
        functionName,
        result: [[3, 7, 14, 22, 29], 5],
      });
    else if (functionName === "getUserTickets") {
      const total = args[0].toLowerCase() === alternateAddress ? 0 : count;
      result = encodeFunctionResult({
        abi: fixtureAbi,
        functionName,
        result: Array.from({ length: total }, (_, i) => ({
          ticketId: args[1] * 1000n + BigInt(i + 1),
          ticket: {
            drawingId: args[1],
            packedTicket: 0n,
            referralScheme: `0x${"00".repeat(32)}` as const,
          },
          normals: i % 2 ? [1, 5, 12, 24, 30] : [3, 7, 14, 22, 29],
          bonusball: i % 2 ? 3 : 5,
        })),
      });
    }
  } else throw new Error(`Unexpected method ${request.method}`);
  return { jsonrpc: "2.0", id: request.id, result };
}
