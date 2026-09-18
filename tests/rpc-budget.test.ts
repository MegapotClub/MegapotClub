import test from "node:test";
import assert from "node:assert/strict";
import { createPublicClient } from "viem";
import { rpcHttp } from "../src/rpcTransport.ts";
import { fetchSnapshot, fetchTicketCollections } from "../src/chain.ts";
import { ticketRpc, fixtureAddress } from "./fixtures/ticketRpc.ts";

test("seven-draw refresh and six-draw ticket history have small actual wire budgets", async (t) => {
  let calls = 0;
  const methods: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) => {
      calls++;
      const request = JSON.parse(String(init?.body));
      methods.push(request.method);
      return Response.json(ticketRpc(request));
    },
  );
  const snapshot = await fetchSnapshot(["https://snapshot-budget.example"]);
  assert.equal(snapshot.recent.length, 6);
  assert.ok(calls <= 7, `snapshot HTTP calls: ${calls}`);
  calls = 0;
  const collections = await fetchTicketCollections(
    ["https://archive-budget.example"],
    fixtureAddress,
    snapshot.recent.map((draw) => draw.id),
  );
  assert.equal(collections.length, 6);
  assert.ok(
    collections.every(
      (item) => item.total === 5 && item.address === fixtureAddress,
    ),
  );
  assert.ok(calls <= 5, `archive HTTP calls: ${calls}`);
  assert.ok(
    methods.every((method) =>
      [
        "eth_chainId",
        "eth_getBlockByNumber",
        "eth_call",
        "eth_getCode",
      ].includes(method),
    ),
  );
});

test("independent clients share the provider's concurrency and start-rate limit", async (t) => {
  let active = 0,
    max = 0;
  const starts: number[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) => {
      starts.push(Date.now());
      active++;
      max = Math.max(max, active);
      await new Promise((resolve) => setTimeout(resolve, 450));
      active--;
      return Response.json({
        jsonrpc: "2.0",
        id: JSON.parse(String(init?.body)).id,
        result: "0x2105",
      });
    },
  );
  await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      createPublicClient({
        transport: rpcHttp(`https://shared-budget.example/key-${i}`),
      }).getChainId(),
    ),
  );
  assert.equal(starts.length, 6);
  assert.ok(max <= 2, `max active: ${max}`);
  assert.ok(starts.slice(1).every((time, i) => time - starts[i] >= 240));
});

test("429 Retry-After suppresses other clients and new attempts without retries", async (t) => {
  let calls = 0,
    limited = true,
    now = Date.now();
  t.mock.method(Date, "now", () => now);
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) => {
      calls++;
      return limited
        ? new Response("rate limited", {
            status: 429,
            headers: { "retry-after": "120" },
          })
        : Response.json({
            jsonrpc: "2.0",
            id: JSON.parse(String(init?.body)).id,
            result: "0x2105",
          });
    },
  );
  const client = () =>
    createPublicClient({
      transport: rpcHttp("https://cooldown-budget.example"),
    });
  await assert.rejects(client().getChainId());
  assert.equal(calls, 1);
  now += 60_000;
  await assert.rejects(client().getChainId());
  assert.equal(calls, 1, "retry-after is shared across clients");
  now += 61_000;
  limited = false;
  assert.equal(await client().getChainId(), 8453);
  assert.equal(calls, 2);
});

test("cancelled queued work never reaches the provider or cancels another client", async (t) => {
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) => {
      calls++;
      return Response.json({
        jsonrpc: "2.0",
        id: JSON.parse(String(init?.body)).id,
        result: "0x2105",
      });
    },
  );
  const abort = new AbortController();
  const first = createPublicClient({
    transport: rpcHttp("https://cancel-budget.example"),
  }).getChainId();
  const second = createPublicClient({
    transport: rpcHttp("https://cancel-budget.example", {
      fetchOptions: { signal: abort.signal },
    }),
  }).getChainId();
  abort.abort();
  await assert.rejects(second);
  assert.equal(await first, 8453);
  assert.equal(calls, 1);
});

test("stalled response bodies cannot hold the shared budget indefinitely", async (t) => {
  let calls = 0,
    abortedBodies = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) => {
      calls++;
      if (calls <= 2)
        return new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                "abort",
                () => {
                  abortedBodies++;
                  controller.error(new DOMException("Aborted", "AbortError"));
                },
                { once: true },
              );
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      return Response.json({
        jsonrpc: "2.0",
        id: JSON.parse(String(init?.body)).id,
        result: "0x2105",
      });
    },
  );
  const client = (timeout: number) =>
    createPublicClient({
      transport: rpcHttp("https://body-budget.example", { timeout }),
    });
  const first = assert.rejects(client(750).getChainId());
  const second = assert.rejects(client(1000).getChainId());
  await new Promise((resolve) => setTimeout(resolve, 300));
  const abort = new AbortController();
  const queued = createPublicClient({
    transport: rpcHttp("https://body-budget.example", {
      fetchOptions: { signal: abort.signal },
    }),
  }).getChainId();
  abort.abort();
  await assert.rejects(queued);
  assert.equal(calls, 2);
  await Promise.all([first, second]);
  assert.equal(abortedBodies, 2);
  assert.equal(await client(2000).getChainId(), 8453);
});
