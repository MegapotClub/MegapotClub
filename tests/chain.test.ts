import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionResult, parseAbi } from "viem";
import { fetchSnapshot, fetchTickets } from "../src/chain.ts";
import { multicallResult } from "./fixtures/multicall.ts";

const abi = parseAbi([
  "function currentDrawingId() view returns (uint256)",
  "function getDrawingState(uint256) view returns ((uint256 prizePool, uint256 ticketPrice, uint256 edgePerTicket, uint256 referralWinShare, uint256 referralFee, uint256 globalTicketsBought, uint256 lpEarnings, uint256 drawingTime, uint256 winningTicket, uint8 ballMax, uint8 bonusballMax, address payoutCalculator, bool jackpotLock))",
]);
type Request = { id: number; method: string; params: unknown[] };
const hash = `0x${"11".repeat(32)}`;

function fixture(
  request: Request,
  block: number,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const aggregate = multicallResult(request, (inner) =>
    fixture(inner, block, timestamp),
  );
  if (aggregate) return { jsonrpc: "2.0", id: request.id, result: aggregate };
  let result: unknown;
  if (request.method === "eth_chainId") result = "0x2105";
  else if (request.method === "eth_getBlockByNumber")
    result = {
      number: `0x${block.toString(16)}`,
      hash,
      timestamp: `0x${timestamp.toString(16)}`,
      transactions: [],
    };
  else if (request.method === "eth_getCode") result = "0x6000";
  else if (request.method === "eth_call") {
    const data = (request.params[0] as { data: `0x${string}` }).data;
    const call = decodeFunctionData({ abi, data });
    result =
      call.functionName === "currentDrawingId"
        ? encodeFunctionResult({
            abi,
            functionName: "currentDrawingId",
            result: 1n,
          })
        : encodeFunctionResult({
            abi,
            functionName: "getDrawingState",
            result: {
              prizePool: 100_000_000n,
              ticketPrice: 1_000_000n,
              edgePerTicket: 0n,
              referralWinShare: 0n,
              referralFee: 0n,
              globalTicketsBought: 12n,
              lpEarnings: 0n,
              drawingTime: BigInt(timestamp + 1000),
              winningTicket: 0n,
              ballMax: 30,
              bonusballMax: 10,
              payoutCalculator: "0x0000000000000000000000000000000000000001",
              jackpotLock: false,
            },
          });
  } else throw new Error(`Unexpected RPC method: ${request.method}`);
  return { jsonrpc: "2.0", id: request.id, result };
}

test("lagging and stale primary observations advance to a healthy fallback", async (t) => {
  for (const failure of ["lagging", "stale"] as const) {
    const observedCalls: { host: string; method: string; params: unknown[] }[] =
      [];
    const mocked = t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const host = new URL(String(input)).hostname;
        const body = JSON.parse(String(init?.body));
        const respond = (request: Request) => {
          observedCalls.push({
            host,
            method: request.method,
            params: request.params,
          });
          const first = host === "primary.example.com";
          return fixture(
            request,
            first && failure === "lagging" ? 100 : 101,
            Math.floor(Date.now() / 1000) -
              (first && failure === "stale" ? 300 : 0),
          );
        };
        return Response.json(
          Array.isArray(body) ? body.map(respond) : respond(body),
        );
      },
    );
    const result = await fetchSnapshot(
      ["https://primary.example.com", "https://fallback.example.com"],
      undefined,
      101n,
    );
    assert.equal(result.blockNumber, "101");
    assert.ok(observedCalls.some((c) => c.host === "primary.example.com"));
    const calls = observedCalls.filter((c) => c.method === "eth_call");
    assert.ok(calls.length > 0);
    assert.ok(
      calls.every(
        (c) => c.host === "fallback.example.com" && c.params[1] === "0x65",
      ),
    );
    mocked.mock.restore();
  }
});

test("an endpoint deadline aborts a stalled body and allows fallback", async (t) => {
  const nativeTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) =>
    nativeTimeout(
      callback,
      delay === 20_000 ? 2_000 : delay,
      ...args,
    )) as typeof setTimeout);
  let bodyAborted = false;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).hostname === "stalled.example.com") {
        return new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                "abort",
                () => {
                  bodyAborted = true;
                  controller.error(new DOMException("Aborted", "AbortError"));
                },
                { once: true },
              );
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      const body = JSON.parse(String(init?.body));
      return Response.json(
        Array.isArray(body)
          ? body.map((r: Request) => fixture(r, 101))
          : fixture(body, 101),
      );
    },
  );
  const result = await fetchSnapshot([
    "https://stalled.example.com",
    "https://fallback.example.com",
  ]);
  assert.equal(result.blockNumber, "101");
  assert.equal(bodyAborted, true);
});

test("a changed block hash rejects the observation instead of mixing provenance", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const respond = (request: Request) => {
        const response = fixture(request, 101);
        if (
          request.method === "eth_getBlockByNumber" &&
          request.params[0] !== "latest"
        )
          response.result = {
            ...(response.result as object),
            hash: `0x${"22".repeat(32)}`,
          };
        return response;
      };
      return Response.json(
        Array.isArray(body) ? body.map(respond) : respond(body),
      );
    },
  );
  await assert.rejects(
    fetchSnapshot(["https://changed.example.com"]),
    /rpcUnavailable/,
  );
});

test("ticket reads reject a missing block identity before querying ownership", async (t) => {
  let ownershipQueried = false;
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const respond = (request: Request) => {
        if (request.method === "eth_call") ownershipQueried = true;
        const response = fixture(request, 101);
        if (request.method === "eth_getBlockByNumber")
          response.result = { ...(response.result as object), hash: null };
        return response;
      };
      return Response.json(
        Array.isArray(body) ? body.map(respond) : respond(body),
      );
    },
  );
  await assert.rejects(
    fetchTickets(
      ["https://missing-hash.example.com"],
      "0x0000000000000000000000000000000000000000",
      "1",
    ),
    /rpcUnavailable/,
  );
  assert.equal(ownershipQueried, false);
});
