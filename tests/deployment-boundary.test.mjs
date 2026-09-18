import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as viem from "viem";
const A = (n) =>
  viem.getAddress(`0x${BigInt(n).toString(16).padStart(40, "0")}`);
const H = (n) => `0x${BigInt(n).toString(16).padStart(64, "0")}`;
const ZERO = A(0),
  code = "0x60006000",
  codeHash = viem.keccak256(code),
  head = 1000n;
const compilation = JSON.parse(
  readFileSync(
    new URL("./deployment-artifact-fixture.json", import.meta.url),
    "utf8",
  ),
);
const oldEnv = [process.env.CLUB_ETHEREUM_RPC, process.env.CLUB_BASE_RPC];
process.env.CLUB_ETHEREUM_RPC = "https://ethereum.test.invalid";
process.env.CLUB_BASE_RPC = "https://base.test.invalid";
after(() => {
  for (const [key, value] of [
    ["CLUB_ETHEREUM_RPC", oldEnv[0]],
    ["CLUB_BASE_RPC", oldEnv[1]],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
let config,
  plan,
  receiptHashes,
  rowsByHash,
  txPatch,
  receiptPatch,
  reorg = false,
  finalityReorg = false,
  headReads = 0,
  flashDisabled = false,
  wrongMinter = false,
  wrongFactory = false,
  nextNonce = 7,
  createdClients = [],
  codes = new Map(),
  slots = new Map(),
  aggregators = new Map(),
  childAddresses = new Map();
const absent = () => ({
  walk: (predicate) => {
    const e = { name: "ContractFunctionRevertedError" };
    return predicate(e) ? e : undefined;
  },
});
const client = (id) => ({
  getChainId: async () => id,
  getTransactionCount: async () => nextNonce,
  getBlock: async ({ blockTag, blockNumber } = {}) => ({
    number: blockTag === "finalized" ? head : (blockNumber ?? head),
    hash:
      reorg && blockNumber === 900n
        ? H(9999)
        : finalityReorg && blockNumber === head && ++headReads > 2
          ? H(9998)
          : H(blockNumber ?? head),
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
  }),
  getCode: async ({ address }) => codes.get(address.toLowerCase()) ?? code,
  getStorageAt: async ({ address, slot }) =>
    slots.get(`${address.toLowerCase()}:${slot}`) ?? H(0),
  readContract: async ({ address, functionName, args = [] }) => {
    const cfg = config.chains[id],
      now = BigInt(Math.floor(Date.now() / 1000));
    if (functionName === "UNDERLYING_ASSET_ADDRESS")
      return address.toLowerCase() === cfg.aWeth.toLowerCase()
        ? cfg.weth
        : cfg.usdc;
    if (functionName === "POOL") return cfg.pool;
    if (functionName === "decimals")
      return address.toLowerCase() === cfg.usdc.toLowerCase() ? 6 : 18;
    if (functionName === "latestRoundData")
      return [
        1n,
        address.toLowerCase() === cfg.sequencer.toLowerCase()
          ? 0n
          : 100_000_000n,
        now - 7200n,
        now - 1n,
        1n,
      ];
    if (functionName === "WETH9") return cfg.weth;
    if (functionName === "factory") return wrongFactory ? A(999) : cfg.factory;
    if (functionName === "getPool") return cfg.swapPool;
    if (functionName === "liquidity") return 1n;
    if (functionName === "getConfiguration")
      return (
        8000n | (1n << 56n) | (1n << 58n) | (flashDisabled ? 0n : 1n << 63n)
      );
    if (functionName === "FLASHLOAN_PREMIUM_TOTAL") return 5n;
    if (functionName === "localMessageTransmitter")
      return config.transport.transmitter;
    if (functionName === "remoteTokenMessengers")
      return viem.padHex(config.transport.messenger, { size: 32 });
    if (functionName === "localDomain") return id === 1 ? 0 : 6;
    if (functionName === "paused" || functionName === "emergencyMode")
      return false;
    if (functionName === "localMinter")
      return wrongMinter ? A(999) : cfg.minter;
    if (functionName === "burnLimitsPerMessage")
      return BigInt(config.transport.maximumBurn);
    if (functionName === "jackpotLPManager") return config.native.manager;
    if (functionName === "usdc") return cfg.usdc;
    if (functionName === "aggregator") {
      const a = aggregators.get(address.toLowerCase());
      if (a !== undefined) return a;
      throw absent();
    }
    if (["waiting", "position"].includes(functionName)) {
      const key = `${id}:${address}:${functionName}`;
      if (!childAddresses.has(key))
        childAddresses.set(key, A(9000 + childAddresses.size));
      return childAddresses.get(key);
    }
    throw new Error(`Unmocked read ${functionName}`);
  },
  getTransactionReceipt: async ({ hash }) => {
    const row = rowsByHash.get(hash);
    return {
      status: "success",
      blockNumber: 900n,
      blockHash: H(900),
      contractAddress: row.expectedAddress,
      ...receiptPatch,
    };
  },
  getTransaction: async ({ hash }) => {
    const row = rowsByHash.get(hash);
    return {
      from: row.from,
      to: null,
      nonce: Number(row.nonce),
      input: row.data,
      value: 0n,
      ...txPatch,
    };
  },
});
mock.module("viem", {
  namedExports: {
    ...viem,
    http: (url) => ({ url }),
    createPublicClient: (options) => {
      createdClients.push(options);
      return client(options.transport.url.includes("ethereum") ? 1 : 8453);
    },
  },
});
const {
  buildDeploymentPlan,
  captureManifest,
  preflight,
  codePin,
  assertReviewedPins,
  externalAddresses,
  IMPLEMENTATION_SLOT,
  BEACON_SLOT,
} = await import("../scripts/vault-deployment.mjs");
function chain(id, start) {
  const c = {
    deployer: A(start),
    nonce: "7",
    swapFee: "500",
    feedMaxAge: "3600",
    sequencerGrace: id === 1 ? "0" : "3600",
    risk: {
      borrowBps: "2500",
      reserveBps: "1000",
      maxDebt: "1000000000000",
      minimumHealth: "2000000000000000000",
      defenseHealth: "1500000000000000000",
      slippageBps: "100",
      flashPremiumBps: "10",
      period: "86400",
      minimumDeposit: "1000000000000000",
    },
  };
  for (const [i, key] of [
    "usdc",
    "weth",
    "pool",
    "aUsdc",
    "aWeth",
    "variableDebt",
    "ethFeed",
    "usdcFeed",
    "sequencer",
    "router",
    "factory",
    "swapPool",
    "minter",
  ].entries())
    c[key] = key === "sequencer" && id === 1 ? ZERO : A(start + i + 1);
  return c;
}
beforeEach(() => {
  config = {
    schema: 1,
    ethPricing: "full-realization-v1",
    chains: { 1: chain(1, 100), 8453: chain(8453, 200) },
    transport: {
      messenger: A(300),
      transmitter: A(301),
      maximumBurn: "10000000000",
    },
    native: { jackpot: A(400), manager: A(401), minimumDeposit: "1000000" },
  };
  for (const id of [1, 8453])
    config.chains[id].reviewedDependencies = externalAddresses(config, id).map(
      (address) => ({ address, codeHash }),
    );
  plan = buildDeploymentPlan(config, compilation);
  receiptHashes = {};
  rowsByHash = new Map();
  plan.transactions.forEach((row, i) => {
    const h = H(i + 1);
    receiptHashes[row.name] = h;
    rowsByHash.set(h, row);
  });
  txPatch = {};
  receiptPatch = {};
  reorg = false;
  finalityReorg = false;
  headReads = 0;
  flashDisabled = false;
  wrongMinter = false;
  wrongFactory = false;
  nextNonce = 7;
  createdClients = [];
  codes = new Map();
  slots = new Map();
  aggregators = new Map();
  childAddresses = new Map();
});
test("unsigned plan has deterministic CREATE addresses, correct chain-local nonce sequences and exact zero value", () => {
  assert.equal(plan.transactions.length, 9);
  for (const id of [1, 8453]) {
    const rows = plan.transactions.filter((t) => t.chainId === id);
    assert.deepEqual(
      rows.map((t) => t.nonce),
      id === 1 ? ["7", "8", "9", "10"] : ["7", "8", "9", "10", "11"],
    );
    for (const row of rows) {
      assert.equal(
        row.expectedAddress,
        viem.getContractAddress({
          from: config.chains[id].deployer,
          nonce: BigInt(row.nonce),
        }),
      );
      assert.equal(row.value, "0");
      assert.equal((row.data.length - 2) / 2, row.initcodeBytes);
    }
  }
  assert.equal(
    IMPLEMENTATION_SLOT,
    viem.toHex(
      BigInt(viem.keccak256(viem.stringToHex("eip1967.proxy.implementation"))) -
        1n,
      { size: 32 },
    ),
  );
  assert.equal(
    BEACON_SLOT,
    viem.toHex(
      BigInt(viem.keccak256(viem.stringToHex("eip1967.proxy.beacon"))) - 1n,
      { size: 32 },
    ),
  );
});
test("activation requires the exact reviewed compiler/config/transaction plan", async () => {
  for (const field of ["compiler", "inputHash"]) {
    const changed = { ...compilation, [field]: "different" };
    await assert.rejects(
      captureManifest(plan, receiptHashes, changed),
      /Plan changed/,
    );
  }
  const modified = structuredClone(plan);
  modified.transactions[0].value = "1";
  await assert.rejects(
    captureManifest(modified, receiptHashes, compilation),
    /Plan changed/,
  );
  const configuration = structuredClone(plan);
  configuration.config.native.minimumDeposit = "2000000";
  await assert.rejects(
    captureManifest(configuration, receiptHashes, compilation),
    /Plan changed/,
  );
  assert.equal(createdClients.length, 0);
});
test("complete finalized CREATE evidence produces all four product pins and disables CCIP", async () => {
  const manifest = await captureManifest(plan, receiptHashes, compilation);
  assert.equal(manifest.deployments.length, 4);
  assert.ok(
    manifest.deployments.every(
      (d) =>
        d.state === "deployed" &&
        d.dependencies.length > 0 &&
        d.dependencies.length <= 24,
    ),
  );
  assert.ok(createdClients.every((c) => c.ccipRead === false));
});
test("capture rejects wrong sender, destination, nonce, initcode, value, status, contract address, unfinalized receipt or reorg", async () => {
  for (const patch of [
    { from: A(999) },
    { to: A(999) },
    { nonce: 99 },
    { input: "0x6001" },
    { value: 1n },
  ]) {
    txPatch = patch;
    await assert.rejects(
      captureManifest(plan, receiptHashes, compilation),
      /Deployment evidence mismatch/,
    );
  }
  txPatch = {};
  for (const patch of [
    { status: "reverted" },
    { contractAddress: A(999) },
    { blockNumber: head + 1n },
  ]) {
    receiptPatch = patch;
    await assert.rejects(
      captureManifest(plan, receiptHashes, compilation),
      /Deployment evidence mismatch/,
    );
  }
  receiptPatch = {};
  reorg = true;
  await assert.rejects(
    captureManifest(plan, receiptHashes, compilation),
    /reorged/,
  );
});
test("reviewed external dependency identities reject omitted, extra, duplicate or changed pins", () => {
  const observed = config.chains[8453].reviewedDependencies;
  assert.doesNotThrow(() => assertReviewedPins(config, 8453, observed));
  for (const changed of [
    observed.slice(1),
    [...observed, observed[0]],
    [{ ...observed[0], codeHash: H(999) }, ...observed.slice(1)],
  ])
    assert.throws(
      () => assertReviewedPins(config, 8453, changed),
      /changed or incomplete/,
    );
  const missing = structuredClone(config);
  delete missing.chains[8453].reviewedDependencies;
  assert.throws(
    () => assertReviewedPins(missing, 8453, observed),
    /Missing reviewed/,
  );
});
test("capture cannot promote upgraded external runtime to a new trusted baseline", async () => {
  codes.set(config.chains[8453].usdc.toLowerCase(), "0x60016000");
  await assert.rejects(
    captureManifest(plan, receiptHashes, compilation),
    /Dependency identity changed/,
  );
});
test("beacon and nested implementation proxies fail closed; RPC probe failure is not treated as absent function", async () => {
  const c = client(1),
    outer = A(800),
    inner = A(801);
  slots.set(
    `${outer.toLowerCase()}:${BEACON_SLOT}`,
    viem.padHex(inner, { size: 32 }),
  );
  await assert.rejects(codePin(c, outer, head), /Beacon proxy/);
  slots.clear();
  slots.set(
    `${outer.toLowerCase()}:${IMPLEMENTATION_SLOT}`,
    viem.padHex(inner, { size: 32 }),
  );
  slots.set(
    `${inner.toLowerCase()}:${IMPLEMENTATION_SLOT}`,
    viem.padHex(A(802), { size: 32 }),
  );
  await assert.rejects(codePin(c, outer, head), /Nested proxy/);
  const broken = {
    ...c,
    getStorageAt: async () => H(0),
    readContract: async () => {
      throw new Error("RPC timeout");
    },
  };
  await assert.rejects(codePin(broken, outer, head), /RPC timeout/);
});
test("nested aggregator links fail closed instead of disappearing from the pin schema", async () => {
  const outer = A(800),
    inner = A(801),
    next = A(802);
  aggregators.set(outer.toLowerCase(), inner);
  aggregators.set(inner.toLowerCase(), next);
  await assert.rejects(codePin(client(1), outer, head), /Nested feed/);
});

test("a supported terminal aggregator produces a complete one-level feed pin", async () => {
  const outer = A(800),
    inner = A(801);
  aggregators.set(outer.toLowerCase(), inner);
  const pin = await codePin(client(1), outer, head);
  assert.deepEqual(pin, {
    address: outer,
    codeHash,
    aggregator: { address: inner, codeHash },
  });
});

test("capture rejects a finalized head that changes during the observation", async () => {
  finalityReorg = true;
  await assert.rejects(
    captureManifest(plan, receiptHashes, compilation),
    /Finalized capture changed/,
  );
});
test("preflight requires actual flash-loan availability and reviewed factory/minter backlinks", async () => {
  const observed = await preflight(plan);
  assert.ok(observed[1] && observed[8453]);
  flashDisabled = true;
  await assert.rejects(preflight(plan), /Aave reserve cannot/);
  flashDisabled = false;
  wrongMinter = true;
  await assert.rejects(preflight(plan), /minter identity changed/);
  wrongMinter = false;
  wrongFactory = true;
  await assert.rejects(preflight(plan), /factory\/pool identity changed/);
});
test("activation rechecks mutable Circle minter backlinks even when all configured code pins match", async () => {
  wrongMinter = true;
  await assert.rejects(
    captureManifest(plan, receiptHashes, compilation),
    /minter identity changed/,
  );
});

test("capture validates finalized dependency state without reusing the obsolete pre-deployment nonce check", async () => {
  nextNonce = 20;
  await assert.rejects(preflight(plan), /Deployer nonce changed/);
  const manifest = await captureManifest(plan, receiptHashes, compilation);
  assert.equal(manifest.deployments.length, 4);
});
