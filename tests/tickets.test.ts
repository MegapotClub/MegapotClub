import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { fetchTickets } from "../src/chain.ts";
import { ticketScope, ticketQueryOptions } from "../src/ticketQuery.ts";
import { parseRoute, routeHref } from "../src/navigation.ts";
import { LANGUAGES } from "../src/i18n.ts";
import { ticketCopy, ticketKeys } from "../src/ticketCopy.ts";
import {
  fixtureAddress,
  alternateAddress,
  ticketRpc,
  type RpcRequest,
} from "./fixtures/ticketRpc.ts";
const urls = ["https://fixture.example"];
function response(init?: RequestInit, count = 5, age = 0) {
  const body = JSON.parse(String(init?.body));
  const one = (r: RpcRequest) =>
    ticketRpc(r, Math.floor(Date.now() / 1000) - age, count);
  return Response.json(Array.isArray(body) ? body.map(one) : one(body));
}
test("explicit public links outrank the wallet; implicit views follow account changes without adding addresses to URLs", () => {
  const route = parseRoute("#tickets?draw=174&page=2");
  assert.deepEqual(ticketScope(route, fixtureAddress, "175"), {
    address: fixtureAddress,
    drawId: "174",
    public: false,
  });
  assert.equal(
    ticketScope(route, alternateAddress, "175").address,
    alternateAddress,
  );
  assert.equal(ticketScope(route, undefined, "175").address, undefined);
  assert.equal(routeHref(route), "#tickets?draw=174&page=2");
  const shared = parseRoute(
    `#tickets?draw=173&address=${alternateAddress}&page=4`,
  );
  assert.equal(
    ticketScope(shared, fixtureAddress, "175").address,
    alternateAddress,
  );
  assert.deepEqual(parseRoute(routeHref(shared)), shared);
  assert.equal(parseRoute("#tickets?page=-1").page, undefined);
  assert.equal(parseRoute("#tickets?page=1e9").page, undefined);
  assert.equal(parseRoute("#tickets?page=999999999").page, undefined);
  assert.equal(
    ticketScope({ view: "tickets" }, fixtureAddress, "176").drawId,
    "176",
  );
});
test("a coherent ticket read retains every record, its draw and block time; all RPC calls are reads", async (t) => {
  const methods: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      (Array.isArray(body) ? body : [body]).forEach((r: RpcRequest) => {
        methods.push(r.method);
        if (r.method === "eth_call") assert.equal(r.params[1], "0x1234567");
      });
      return response(init, 125);
    },
  );
  const result = await fetchTickets(urls, fixtureAddress, "174");
  assert.equal(result.total, 125);
  assert.equal(result.tickets.length, 125);
  assert.equal(result.draw.id, "174");
  assert.equal(result.draw.result?.bonus, 5);
  assert.equal(result.blockNumber, "19088743");
  assert.ok(result.blockTime > 0);
  assert.ok(
    methods.every((m) =>
      ["eth_chainId", "eth_getBlockByNumber", "eth_call"].includes(m),
    ),
  );
});
test("late reads cannot populate a new address/draw; a failed refresh retains the same query data", async (t) => {
  let failed = false;
  const reads: Array<{
    request: RpcRequest;
    init: RequestInit;
    resolve: (r: Response) => void;
  }> = [];
  let hold = false;
  let captureHeld: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    captureHeld = resolve;
  });
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (failed) throw new Error("offline");
      if (hold)
        return new Promise<Response>((resolve) => {
          reads.push({
            request: JSON.parse(String(init?.body)),
            init: init!,
            resolve,
          });
          captureHeld();
        });
      return response(init);
    },
  );
  const client = new QueryClient();
  const options = (address: string | undefined, draw = "175") =>
    ticketQueryOptions(
      urls,
      ticketScope({ view: "tickets", draw }, address, "175"),
    );
  const observer = new QueryObserver(client, options(fixtureAddress));
  const stop = observer.subscribe(() => {});
  await observer.refetch();
  assert.equal(observer.getCurrentResult().data?.total, 5);
  failed = true;
  await observer.refetch();
  assert.equal(observer.getCurrentResult().isError, true);
  assert.equal(observer.getCurrentResult().data?.address, fixtureAddress);
  failed = false;
  hold = true;
  observer.setOptions(options(fixtureAddress, "174"));
  assert.equal(observer.getCurrentResult().data, undefined);
  await held;
  assert.ok(reads.length > 0);
  hold = false;
  observer.setOptions(options(alternateAddress));
  assert.equal(observer.getCurrentResult().data, undefined);
  await observer.refetch();
  for (const read of reads) read.resolve(response(read.init));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(observer.getCurrentResult().data?.address, alternateAddress);
  assert.equal(observer.getCurrentResult().data?.total, 0);
  observer.setOptions(options(undefined));
  assert.equal(observer.getCurrentResult().data, undefined);
  stop();
  client.clear();
});
test("stale ticket RPC observations fail, and cancelled reads do not try another endpoint", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: RequestInfo | URL, init?: RequestInit) =>
      response(init, 5, 1000),
  );
  await assert.rejects(
    fetchTickets(urls, fixtureAddress, "175"),
    /rpcUnavailable/,
  );
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("unexpected");
  });
  await assert.rejects(
    fetchTickets(urls, fixtureAddress, "175", controller.signal),
    { name: "AbortError" },
  );
  assert.equal(calls, 0);
  await assert.rejects(fetchTickets(urls, fixtureAddress, "0"), /invalidDraw/);
});
test("ticket copy covers eight locales with identical interpolation variables", () => {
  for (const key of ticketKeys) {
    const expected = [...ticketCopy("en")(key).matchAll(/\{\w+\}/g)]
      .map((x) => x[0])
      .sort();
    for (const { code } of LANGUAGES) {
      const text = ticketCopy(code)(key);
      assert.ok(text.length);
      assert.deepEqual(
        [...text.matchAll(/\{\w+\}/g)].map((x) => x[0]).sort(),
        expected,
        `${code}:${key}`,
      );
    }
  }
});

test("cancelling one read cannot abort another read using the same RPC URL", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      // Yield to an account change before the transport completes its response.
      await Promise.resolve();
      init?.signal?.throwIfAborted();
      return response(init);
    },
  );
  const a = new AbortController(),
    b = new AbortController();
  const first = fetchTickets(urls, fixtureAddress, "174", a.signal);
  const second = fetchTickets(urls, alternateAddress, "175", b.signal);
  a.abort();
  const [cancelled, active] = await Promise.allSettled([first, second]);
  assert.equal(cancelled.status, "rejected");
  if (cancelled.status === "rejected")
    assert.equal(cancelled.reason.name, "AbortError");
  assert.equal(b.signal.aborted, false);
  assert.equal(active.status, "fulfilled");
  if (active.status === "fulfilled") {
    assert.equal(active.value.address, alternateAddress);
    assert.equal(active.value.drawId, "175");
    assert.equal(active.value.total, 0);
  }
});
