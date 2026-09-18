import { decodeFunctionData, encodeFunctionResult, multicall3Abi } from "viem";
type Request = { id: number; method: string; params: unknown[] };
/** Decode the actual Multicall3 wire request, then dispatch each inner call. */
export function multicallResult(
  request: Request,
  respond: (request: Request) => { result: unknown },
) {
  if (request.method !== "eth_call") return undefined;
  const call = request.params[0] as { to?: string; data: `0x${string}` };
  if (call.to?.toLowerCase() !== "0xca11bde05977b3631167028862be2a173976ca11")
    return undefined;
  const decoded = decodeFunctionData({ abi: multicall3Abi, data: call.data });
  if (decoded.functionName !== "aggregate3")
    throw new Error("unexpected multicall");
  return encodeFunctionResult({
    abi: multicall3Abi,
    functionName: "aggregate3",
    result: decoded.args[0].map((item) => ({
      success: true,
      returnData: respond({
        ...request,
        params: [{ to: item.target, data: item.callData }, request.params[1]],
      }).result as `0x${string}`,
    })),
  });
}
