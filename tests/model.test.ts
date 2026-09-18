import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  money,
  parseSnapshot,
  parseRpcUrls,
  phase,
  countdown,
  parseTicketRecords,
  parseCachedSnapshot,
} from "../src/model.ts";
import { JACKPOT } from "../src/config.ts";

const seed = JSON.parse(
  readFileSync(new URL("../src/snapshot.json", import.meta.url), "utf8"),
);
test("future-dated browser cache is rejected without rejecting a genuine saved observation", () => {
  assert.ok(parseCachedSnapshot(seed, JACKPOT, seed.observedAt));
  const future = structuredClone(seed);
  future.observedAt += 86_400_000;
  future.blockTime += 86_400;
  assert.equal(parseCachedSnapshot(future, JACKPOT, seed.observedAt), null);
});
test("accepts the independently captured public snapshot", () => {
  const s = parseSnapshot(seed, JACKPOT);
  assert.ok(s);
  assert.equal(s.chainId, 8453);
  assert.equal(s.recent.length, 6);
});
test("rejects corrupt, cross-chain, duplicate and semantically malformed observations", () => {
  for (const change of [
    (s: typeof seed) => (s.chainId = 1),
    (s: typeof seed) =>
      (s.address = "0x0000000000000000000000000000000000000000"),
    (s: typeof seed) => (s.current.prizePool = "-1"),
    (s: typeof seed) => (s.current.prizePool = 123.5),
    (s: typeof seed) => (s.recent[0].id = s.current.id),
    (s: typeof seed) => (s.recent[0].result.numbers = [1, 1, 2, 3, 4]),
    (s: typeof seed) => (s.recent[0].result.bonus = 0),
    (s: typeof seed) => (s.current.closesAt = NaN),
    (s: typeof seed) => (s.current.closesAt = Number.MAX_SAFE_INTEGER),
    (s: typeof seed) => (s.blockTime = Number.MAX_SAFE_INTEGER),
    (s: typeof seed) => (s.observedAt = Number.MAX_SAFE_INTEGER),
    (s: typeof seed) =>
      (s.blockTime = Math.floor(s.observedAt / 1000) + 86_400),
  ]) {
    const s = structuredClone(seed);
    change(s);
    assert.equal(parseSnapshot(s, JACKPOT), null);
  }
  assert.equal(parseSnapshot(null, JACKPOT), null);
  assert.equal(parseSnapshot({}, JACKPOT), null);
});
test("formats raw USDC exactly beyond Number precision, including half-unit rounding", () => {
  assert.equal(
    money("900719925474099312345678", "en", 2),
    "900,719,925,474,099,312.35",
  );
  assert.equal(money("999999", "en", 2), "1.00");
  assert.equal(money("1499999", "en"), "1");
  assert.equal(money("1500000", "en"), "2");
  assert.equal(money("123450000", "de", 2), "123,45");
  assert.equal(money("1", "en", 6), "0.000001");
  assert.equal(money("10000123", "en", 6), "10.000123");
  assert.equal(
    money("900719925474099312345678", "en", 6),
    "900,719,925,474,099,312.345678",
  );
  assert.equal(money("-1", "en", 6), "−0.000001");
});
test("draw phase uses chain settlement before lock and time; countdown never goes negative", () => {
  const d = seed.current;
  assert.equal(phase({ ...d, settled: true, locked: true }, 0), "settled");
  assert.equal(phase({ ...d, settled: false, locked: true }, 0), "settling");
  assert.equal(
    phase({ ...d, settled: false, locked: false }, d.closesAt * 1000),
    "awaiting",
  );
  assert.deepEqual(countdown(100, 101000), ["00", "00", "00"]);
  assert.deepEqual(countdown(10000, 0), ["02", "46", "40"]);
});
test("rejects executable URLs, embedded credentials and private RPC targets", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://rpc.example.com",
    "https://user:pass@rpc.example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://192.168.0.1",
    "https://172.20.0.1",
    "https://rpc.example.com/#x",
    "https://rpc.example.com:4433",
    "https://rpc.localhost",
    "https://rpc.internal",
    "https://rpc.local.",
    "https://0.0.0.0",
    "https://100.64.0.1",
    "https://224.0.0.1",
    "https://[::ffff:127.0.0.1]",
  ])
    assert.throws(() => parseRpcUrls([url]));
  assert.throws(() => parseRpcUrls([]));
  assert.deepEqual(
    parseRpcUrls(["https://mainnet.base.org", "https://mainnet.base.org/"]),
    ["https://mainnet.base.org/"],
  );
});

test("ticket observations reject mismatched draws, duplicate IDs and invalid number sets", () => {
  const ticket = {
    id: "1",
    drawId: seed.current.id,
    numbers: [1, 2, 3, 4, 5],
    bonus: 1,
  };
  assert.deepEqual(parseTicketRecords([ticket], seed.current), [ticket]);
  assert.deepEqual(parseTicketRecords([], seed.current), []);
  assert.equal(parseTicketRecords([ticket, ticket], seed.current), null);
  for (const change of [
    { drawId: "999" },
    { id: "-1" },
    { numbers: [0, 1, 2, 3, 4] },
    { numbers: [1, 1, 2, 3, 4] },
    { numbers: [1, 2, 3, 4, 5, 6] },
    { numbers: [1, 2, 3, 4, seed.current.ballMax + 1] },
    { bonus: 0 },
    { bonus: seed.current.bonusMax + 1 },
  ])
    assert.equal(
      parseTicketRecords([{ ...ticket, ...change }], seed.current),
      null,
    );
});
