import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { compileContracts } from "./compile-contracts.mjs";
import {
  createPublicClient,
  http,
  getAddress,
  isAddress,
  getContractAddress,
  encodeDeployData,
  keccak256,
  padHex,
  parseAbi,
  stringToHex,
} from "viem";

const ZERO = "0x0000000000000000000000000000000000000000";
export const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const LEGACY_IMPLEMENTATION_SLOT = keccak256(
  stringToHex("org.zeppelinos.proxy.implementation"),
);
export const BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
const address = (a, zero = false) => {
  if (
    typeof a !== "string" ||
    !isAddress(a) ||
    (!zero && a.toLowerCase() === ZERO)
  )
    throw new Error("A reviewed nonzero address is required");
  return getAddress(a);
};
const integer = (s, min = 0n, max = 2n ** 256n - 1n) => {
  if (typeof s !== "string" || !/^(0|[1-9]\d{0,77})$/.test(s))
    throw new Error("Expected an exact decimal integer string");
  const n = BigInt(s);
  if (n < min || n > max) throw new Error("Integer outside permitted range");
  return n;
};
const stringify = (v) =>
  JSON.stringify(v, (_, n) => (typeof n === "bigint" ? n.toString() : n), 2);
const riskKeys = [
  "borrowBps",
  "reserveBps",
  "maxDebt",
  "minimumHealth",
  "defenseHealth",
  "slippageBps",
  "flashPremiumBps",
  "period",
  "minimumDeposit",
];
const DEPENDENCIES = [
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
];

/** Exact unsigned CREATE transactions. Never accepts a signing key or broadcasts. */
export function buildDeploymentPlan(config, compilation) {
  if (config.schema !== 1 || config.ethPricing !== "full-realization-v1")
    throw new Error("Unknown deployment schema or ETH pricing architecture");
  const chains = {};
  for (const id of [1, 8453]) {
    const raw = config.chains?.[id];
    if (!raw) throw new Error(`Missing chain ${id}`);
    const c = {
      ...raw,
      deployer: address(raw.deployer),
      nonce: integer(raw.nonce, 0n, BigInt(Number.MAX_SAFE_INTEGER) - 10n),
    };
    for (const key of DEPENDENCIES)
      c[key] = address(raw[key], key === "sequencer" && id === 1);
    if (id === 1 && c.sequencer !== ZERO)
      throw new Error("Ethereum L1 has no sequencer feed");
    c.risk = riskKeys.map((k) => integer(raw.risk?.[k]));
    const [b, r, cap, minHealth, defense, slip, premium, period, min] = c.risk;
    if (
      b > 5000n ||
      r > 10000n ||
      !cap ||
      minHealth <= defense ||
      defense <= 10n ** 18n ||
      slip > 200n ||
      premium > 100n ||
      period < 3600n ||
      period > 365n * 86400n ||
      !min
    )
      throw new Error("Risk values violate contract bounds");
    c.feedMaxAge = integer(raw.feedMaxAge, 1n);
    c.sequencerGrace = integer(raw.sequencerGrace, id === 1 ? 0n : 1n);
    c.swapFee = Number(integer(raw.swapFee, 1n, 2n ** 24n - 1n));
    chains[id] = c;
  }
  const base = chains[8453],
    l1 = chains[1],
    at = (c, offset) =>
      getContractAddress({ from: c.deployer, nonce: c.nonce + BigInt(offset) });
  const addresses = {
    baseUsdc: at(base, 0),
    baseInbox: at(base, 1),
    basePrices: at(base, 2),
    baseEth: at(base, 3),
    baseKeeper: at(base, 4),
    l1Usdc: at(l1, 0),
    l1Prices: at(l1, 1),
    l1Eth: at(l1, 2),
    l1Keeper: at(l1, 3),
  };
  const messenger = address(config.transport.messenger),
    transmitter = address(config.transport.transmitter),
    maximumBurn = integer(config.transport.maximumBurn, 1_000_000n);
  const route = (c, peer, remote, domain, remoteDomain, id) => [
    c.usdc,
    messenger,
    transmitter,
    peer,
    padHex(remote.usdc, { size: 32 }),
    padHex(messenger, { size: 32 }),
    domain,
    remoteDomain,
    BigInt(id),
    maximumBurn,
  ];
  const native = [
    base.usdc,
    address(config.native.jackpot),
    address(config.native.manager),
    base.pool,
    base.aUsdc,
    integer(config.native.minimumDeposit, 1n),
  ];
  const eth = (c, id, prices, service, kind) => [
    [
      c.weth,
      c.usdc,
      c.pool,
      c.aWeth,
      c.variableDebt,
      c.router,
      prices,
      c.swapFee,
      service,
      kind,
      BigInt(id),
    ],
    c.risk,
    `Megapot Club ${id === 1 ? "Ethereum" : "Base"} Ether`,
    id === 1 ? "mcL1ETH" : "mcETH",
  ];
  const rows = [
    ["baseUsdc", 8453, 0, "BaseUsdcVault", native],
    [
      "l1Usdc",
      1,
      0,
      "EthereumUsdcVault",
      [route(l1, addresses.baseInbox, base, 0, 6, 1)],
    ],
    [
      "baseInbox",
      8453,
      1,
      "BaseInbox",
      [route(base, addresses.l1Usdc, l1, 6, 0, 8453), addresses.baseUsdc],
    ],
    [
      "basePrices",
      8453,
      2,
      "PriceGuard",
      [
        base.ethFeed,
        base.usdcFeed,
        base.sequencer,
        base.feedMaxAge,
        base.sequencerGrace,
      ],
    ],
    [
      "baseEth",
      8453,
      3,
      "SharedEthVault",
      eth(base, 8453, addresses.basePrices, addresses.baseUsdc, 0),
    ],
    [
      "l1Prices",
      1,
      1,
      "PriceGuard",
      [l1.ethFeed, l1.usdcFeed, l1.sequencer, l1.feedMaxAge, l1.sequencerGrace],
    ],
    [
      "l1Eth",
      1,
      2,
      "SharedEthVault",
      eth(l1, 1, addresses.l1Prices, addresses.l1Usdc, 1),
    ],
    [
      "baseKeeper",
      8453,
      4,
      "KeeperBudget",
      [addresses.baseUsdc, addresses.baseInbox],
    ],
    ["l1Keeper", 1, 3, "KeeperBudget", [ZERO, addresses.l1Usdc]],
  ];
  const transactions = rows.map(([name, chainId, offset, contract, args]) => {
    const artifact = compilation.contracts[contract];
    if (!artifact?.evm?.bytecode?.object)
      throw new Error(`Missing compiled ${contract}`);
    const data = encodeDeployData({
      abi: artifact.abi,
      bytecode: `0x${artifact.evm.bytecode.object}`,
      args,
    });
    if ((data.length - 2) / 2 > 49152 || artifact.deployedBytes > 24576)
      throw new Error(`${contract} exceeds Ethereum contract size limits`);
    return {
      name,
      chainId,
      contract,
      from: chains[chainId].deployer,
      nonce: (chains[chainId].nonce + BigInt(offset)).toString(),
      value: "0",
      data,
      expectedAddress: addresses[name],
      constructorArgs: args,
      initcodeBytes: (data.length - 2) / 2,
      runtimeBytes: artifact.deployedBytes,
    };
  });
  return {
    schema: 1,
    kind: "unsigned-deployment-review",
    compiler: compilation.compiler,
    inputHash: compilation.inputHash,
    configHash: createHash("sha256").update(stringify(config)).digest("hex"),
    config,
    addresses,
    transactions,
  };
}

export const clientFor = (id) => {
  const url = process.env[id === 1 ? "CLUB_ETHEREUM_RPC" : "CLUB_BASE_RPC"];
  if (
    !url ||
    new URL(url).protocol !== "https:" ||
    new URL(url).username ||
    new URL(url).password
  )
    throw new Error(`Set HTTPS CLUB_${id === 1 ? "ETHEREUM" : "BASE"}_RPC`);
  return createPublicClient({
    ccipRead: false,
    transport: http(url, {
      timeout: 20000,
      retryCount: 2,
      batch: { wait: 20 },
    }),
  });
};
export async function codePin(c, a, blockNumber) {
  const code = await c.getCode({ address: a, blockNumber });
  if (!code || code === "0x") throw new Error(`No code at ${a}`);
  const pin = { address: getAddress(a), codeHash: keccak256(code) };
  const beacon = await c.getStorageAt({
    address: a,
    slot: BEACON_SLOT,
    blockNumber,
  });
  if (beacon && BigInt(beacon) !== 0n)
    throw new Error("Beacon proxy is not supported by the reviewed pin schema");
  for (const slot of [IMPLEMENTATION_SLOT, LEGACY_IMPLEMENTATION_SLOT]) {
    const raw = await c.getStorageAt({ address: a, slot, blockNumber });
    if (!raw || BigInt(raw) === 0n) continue;
    if (pin.implementation)
      throw new Error(`Ambiguous proxy implementation at ${a}`);
    const impl = getAddress(`0x${raw.slice(-40)}`),
      implementation = await c.getCode({ address: impl, blockNumber });
    if (!implementation || implementation === "0x")
      throw new Error(`Missing implementation at ${impl}`);
    await requireTerminal(c, impl, blockNumber);
    pin.implementation = {
      slot,
      address: impl,
      codeHash: keccak256(implementation),
    };
  }
  try {
    const aggregator = await c.readContract({
      address: a,
      abi: parseAbi(["function aggregator() view returns (address)"]),
      functionName: "aggregator",
      blockNumber,
    });
    if (aggregator !== ZERO) {
      const code = await c.getCode({ address: aggregator, blockNumber });
      if (!code || code === "0x") throw new Error("Missing feed aggregator");
      await requireTerminal(c, aggregator, blockNumber);
      pin.aggregator = {
        address: getAddress(aggregator),
        codeHash: keccak256(code),
      };
    }
  } catch (error) {
    const absent = error.walk?.((e) =>
      [
        "ContractFunctionRevertedError",
        "ContractFunctionZeroDataError",
      ].includes(e.name),
    );
    if (
      !absent ||
      ![
        "ContractFunctionRevertedError",
        "ContractFunctionZeroDataError",
      ].includes(absent.name)
    )
      throw error;
  }
  return pin;
}

async function requireTerminal(c, a, blockNumber) {
  for (const slot of [
    IMPLEMENTATION_SLOT,
    LEGACY_IMPLEMENTATION_SLOT,
    BEACON_SLOT,
  ]) {
    const v = await c.getStorageAt({ address: a, slot, blockNumber });
    if (v && BigInt(v) !== 0n)
      throw new Error(
        "Nested proxy targets require a separately reviewed pin schema",
      );
  }
  try {
    const nested = await c.readContract({
      address: a,
      abi: parseAbi(["function aggregator() view returns (address)"]),
      functionName: "aggregator",
      blockNumber,
    });
    if (nested !== ZERO)
      throw new Error(
        "Nested feed targets require a separately reviewed pin schema",
      );
  } catch (error) {
    const absent = error.walk?.((e) =>
      [
        "ContractFunctionRevertedError",
        "ContractFunctionZeroDataError",
      ].includes(e.name),
    );
    if (
      !absent ||
      ![
        "ContractFunctionRevertedError",
        "ContractFunctionZeroDataError",
      ].includes(absent.name)
    )
      throw error;
  }
}
export function externalAddresses(config, id) {
  const cfg = config.chains[id];
  return [
    ...new Set(
      [
        ...DEPENDENCIES.map((k) => cfg[k]),
        config.transport.messenger,
        config.transport.transmitter,
        ...(id === 8453 ? [config.native.jackpot, config.native.manager] : []),
      ].map((a) => address(a, true).toLowerCase()),
    ),
  ]
    .filter((a) => a !== ZERO)
    .map((a) => getAddress(a));
}
function normalizedPin(p) {
  const hash = (h) => {
    if (
      typeof h !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(h) ||
      /^0x0+$/.test(h)
    )
      throw new Error("Invalid reviewed pin hash");
    return h.toLowerCase();
  };
  return {
    address: address(p.address).toLowerCase(),
    codeHash: hash(p.codeHash),
    ...(p.implementation
      ? {
          implementation: {
            slot: hash(p.implementation.slot),
            address: address(p.implementation.address).toLowerCase(),
            codeHash: hash(p.implementation.codeHash),
          },
        }
      : {}),
    ...(p.aggregator
      ? {
          aggregator: {
            address: address(p.aggregator.address).toLowerCase(),
            codeHash: hash(p.aggregator.codeHash),
          },
        }
      : {}),
  };
}
/** Previously reviewed identities cannot be replaced by newly observed upstream code during activation. */
export function assertReviewedPins(config, id, observed) {
  const expected = config.chains[id].reviewedDependencies;
  const required = externalAddresses(config, id)
    .map((a) => a.toLowerCase())
    .sort();
  if (!Array.isArray(expected))
    throw new Error("Missing reviewed dependency identities");
  const sort = (pins) =>
    pins.map(normalizedPin).sort((a, b) => a.address.localeCompare(b.address));
  const e = sort(expected),
    o = sort(observed);
  if (
    JSON.stringify(e.map((p) => p.address)) !== JSON.stringify(required) ||
    JSON.stringify(e) !== JSON.stringify(o)
  )
    throw new Error(
      `Dependency identity changed or incomplete on ${id}; review a new deployment configuration explicitly`,
    );
}

export async function preflight(plan, { checkNonce = true, blocks } = {}) {
  const observations = {};
  const tokenAbi = parseAbi([
    "function decimals() view returns (uint8)",
    "function UNDERLYING_ASSET_ADDRESS() view returns (address)",
    "function POOL() view returns (address)",
  ]);
  const feedAbi = parseAbi([
    "function decimals() view returns (uint8)",
    "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  ]);
  const routerAbi = parseAbi([
    "function WETH9() view returns (address)",
    "function factory() view returns (address)",
  ]);
  for (const id of [8453, 1]) {
    const c = clientFor(id),
      cfg = plan.config.chains[id],
      block = blocks?.[id] ?? (await c.getBlock());
    if ((await c.getChainId()) !== id) throw new Error(`Wrong chain ${id}`);
    if (
      checkNonce &&
      (await c.getTransactionCount({
        address: cfg.deployer,
        blockTag: "pending",
      })) !== Number(cfg.nonce)
    )
      throw new Error(`Deployer nonce changed on ${id}`);
    const pins = await Promise.all(
      externalAddresses(plan.config, id).map((a) =>
        codePin(c, a, block.number),
      ),
    );
    assertReviewedPins(plan.config, id, pins);
    for (const [token, underlying] of [
      [cfg.aUsdc, cfg.usdc],
      [cfg.aWeth, cfg.weth],
      [cfg.variableDebt, cfg.usdc],
    ]) {
      const [actual, pool] = await Promise.all(
        ["UNDERLYING_ASSET_ADDRESS", "POOL"].map((functionName) =>
          c.readContract({
            address: token,
            abi: tokenAbi,
            functionName,
            blockNumber: block.number,
          }),
        ),
      );
      if (
        actual.toLowerCase() !== underlying.toLowerCase() ||
        pool.toLowerCase() !== cfg.pool.toLowerCase()
      )
        throw new Error("Aave token/pool identity mismatch");
    }
    for (const [token, expected] of [
      [cfg.usdc, 6],
      [cfg.weth, 18],
    ])
      if (
        (await c.readContract({
          address: token,
          abi: tokenAbi,
          functionName: "decimals",
          blockNumber: block.number,
        })) !== expected
      )
        throw new Error("Unsupported token precision");
    for (const feed of [cfg.ethFeed, cfg.usdcFeed]) {
      const r = await c.readContract({
        address: feed,
        abi: feedAbi,
        functionName: "latestRoundData",
        blockNumber: block.number,
      });
      if (
        r[1] <= 0n ||
        r[3] === 0n ||
        r[3] > block.timestamp ||
        block.timestamp - r[3] > BigInt(cfg.feedMaxAge) ||
        r[4] < r[0]
      )
        throw new Error("Stale or invalid price feed");
    }
    if (cfg.sequencer !== ZERO) {
      const r = await c.readContract({
        address: cfg.sequencer,
        abi: feedAbi,
        functionName: "latestRoundData",
        blockNumber: block.number,
      });
      if (
        r[1] !== 0n ||
        r[2] === 0n ||
        r[2] > block.timestamp ||
        block.timestamp - r[2] <= BigInt(cfg.sequencerGrace)
      )
        throw new Error("Sequencer unsafe or in grace period");
    }
    const routerWeth = await c.readContract({
      address: cfg.router,
      abi: routerAbi,
      functionName: "WETH9",
      blockNumber: block.number,
    });
    if (routerWeth.toLowerCase() !== cfg.weth.toLowerCase())
      throw new Error("Wrong router WETH");
    const read = (address, signature, functionName, args = []) =>
      c.readContract({
        address,
        abi: parseAbi([signature]),
        functionName,
        args,
        blockNumber: block.number,
      });
    const factory = await read(
      cfg.router,
      "function factory() view returns (address)",
      "factory",
    );
    const swapPool = await read(
      factory,
      "function getPool(address,address,uint24) view returns (address)",
      "getPool",
      [cfg.weth, cfg.usdc, Number(cfg.swapFee)],
    );
    if (
      factory.toLowerCase() !== cfg.factory.toLowerCase() ||
      swapPool.toLowerCase() !== cfg.swapPool.toLowerCase()
    )
      throw new Error("Router factory/pool identity changed");
    if (
      swapPool === ZERO ||
      (await read(
        swapPool,
        "function liquidity() view returns (uint128)",
        "liquidity",
      )) === 0n
    )
      throw new Error("Selected swap pool has no active liquidity");
    for (const [asset, borrowing] of [
      [cfg.usdc, true],
      [cfg.weth, false],
    ]) {
      const data = await read(
        cfg.pool,
        "function getConfiguration(address) view returns (uint256)",
        "getConfiguration",
        [asset],
      );
      if (
        !(data & (1n << 56n)) ||
        data & (1n << 57n) ||
        data & (1n << 60n) ||
        (borrowing && (!(data & (1n << 58n)) || !(data & (1n << 63n)))) ||
        (!borrowing && !(data & 65535n))
      )
        throw new Error("Aave reserve cannot support the proposed strategy");
    }
    if (
      (await read(
        cfg.pool,
        "function FLASHLOAN_PREMIUM_TOTAL() view returns (uint128)",
        "FLASHLOAN_PREMIUM_TOTAL",
      )) > BigInt(cfg.risk.flashPremiumBps)
    )
      throw new Error("Aave flash premium exceeds the immutable bound");
    const transport = plan.config.transport,
      domain = id === 1 ? 0 : 6,
      remoteDomain = id === 1 ? 6 : 0;
    if (
      (
        await read(
          transport.messenger,
          "function localMessageTransmitter() view returns (address)",
          "localMessageTransmitter",
        )
      ).toLowerCase() !== transport.transmitter.toLowerCase() ||
      (
        await read(
          transport.messenger,
          "function remoteTokenMessengers(uint32) view returns (bytes32)",
          "remoteTokenMessengers",
          [remoteDomain],
        )
      ).toLowerCase() !==
        padHex(transport.messenger, { size: 32 }).toLowerCase() ||
      (await read(
        transport.transmitter,
        "function localDomain() view returns (uint32)",
        "localDomain",
      )) !== domain ||
      (await read(
        transport.transmitter,
        "function paused() view returns (bool)",
        "paused",
      ))
    )
      throw new Error(
        "Circle route is paused or does not match the fixed pair",
      );
    const minter = await read(
      transport.messenger,
      "function localMinter() view returns (address)",
      "localMinter",
    );
    if (minter.toLowerCase() !== cfg.minter.toLowerCase())
      throw new Error("Circle minter identity changed");
    if (
      (await read(
        minter,
        "function burnLimitsPerMessage(address) view returns (uint256)",
        "burnLimitsPerMessage",
        [cfg.usdc],
      )) < BigInt(transport.maximumBurn)
    )
      throw new Error("Configured CCTP chunk exceeds its burn limit");
    if (id === 8453) {
      const native = plan.config.native;
      if (
        (
          await read(
            native.jackpot,
            "function jackpotLPManager() view returns (address)",
            "jackpotLPManager",
          )
        ).toLowerCase() !== native.manager.toLowerCase() ||
        (
          await read(
            native.jackpot,
            "function usdc() view returns (address)",
            "usdc",
          )
        ).toLowerCase() !== cfg.usdc.toLowerCase() ||
        (await read(
          native.jackpot,
          "function emergencyMode() view returns (bool)",
          "emergencyMode",
        ))
      )
        throw new Error(
          "Native pool identity changed or emergency mode is active",
        );
    }

    if ((await c.getBlock({ blockNumber: block.number })).hash !== block.hash)
      throw new Error("Preflight observation reorged");
    observations[id] = {
      block: block.number,
      timestamp: block.timestamp,
      blockHash: block.hash,
      pins,
    };
  }
  return observations;
}

/** Capture activation only from finalized receipts matching the exact compiled CREATE input, deployer and nonce. */
export async function captureManifest(plan, receipts, compilation) {
  const rebuilt = buildDeploymentPlan(plan.config, compilation);
  if (stringify(rebuilt) !== stringify(plan))
    throw new Error("Plan changed or does not match this compiler input");
  const observed = {},
    heads = {},
    clients = {};
  for (const id of [1, 8453]) {
    clients[id] = clientFor(id);
    if ((await clients[id].getChainId()) !== id) throw new Error("Wrong chain");
    heads[id] = await clients[id].getBlock({ blockTag: "finalized" });
  }
  await preflight(plan, { checkNonce: false, blocks: heads });
  for (const tx of plan.transactions) {
    const c = clients[tx.chainId],
      hash = receipts[tx.name];
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? ""))
      throw new Error(`Missing receipt ${tx.name}`);
    const [r, t] = await Promise.all([
      c.getTransactionReceipt({ hash }),
      c.getTransaction({ hash }),
    ]);
    if (
      r.status !== "success" ||
      r.blockNumber > heads[tx.chainId].number ||
      t.from.toLowerCase() !== tx.from.toLowerCase() ||
      t.to !== null ||
      t.nonce !== Number(tx.nonce) ||
      t.input.toLowerCase() !== tx.data.toLowerCase() ||
      t.value !== 0n ||
      r.contractAddress?.toLowerCase() !== tx.expectedAddress.toLowerCase()
    )
      throw new Error(`Deployment evidence mismatch: ${tx.name}`);
    if ((await c.getBlock({ blockNumber: r.blockNumber })).hash !== r.blockHash)
      throw new Error("Deployment receipt reorged");
    observed[tx.name] = {
      block: r.blockNumber,
      pin: await codePin(c, tx.expectedAddress, heads[tx.chainId].number),
    };
  }
  const deployments = [];
  for (const [product, name, chainId, asset] of [
    ["base-usdc", "baseUsdc", 8453, "usdc"],
    ["base-eth", "baseEth", 8453, "weth"],
    ["l1-usdc", "l1Usdc", 1, "usdc"],
    ["l1-eth", "l1Eth", 1, "weth"],
  ]) {
    const c = clients[chainId],
      cfg = plan.config.chains[chainId],
      block = heads[chainId].number;
    const local = plan.transactions
      .filter((t) => t.chainId === chainId)
      .map((t) => t.expectedAddress);
    const external = externalAddresses(plan.config, chainId);
    assertReviewedPins(
      plan.config,
      chainId,
      await Promise.all(external.map((a) => codePin(c, a, block))),
    );
    const children = [];
    for (const key of chainId === 8453 ? ["baseUsdc", "baseEth"] : ["l1Eth"]) {
      const abi =
        compilation.contracts[
          key === "baseUsdc" ? "BaseUsdcVault" : "SharedEthVault"
        ].abi;
      for (const getter of key === "baseUsdc"
        ? ["waiting"]
        : ["waiting", "position"])
        children.push(
          await c.readContract({
            address: plan.addresses[key],
            abi,
            functionName: getter,
            blockNumber: block,
          }),
        );
    }
    const all = [
      ...new Set(
        [...local, ...external, ...children].map((a) => a.toLowerCase()),
      ),
    ].filter(
      (a) =>
        a !== ZERO &&
        a !== plan.addresses[name].toLowerCase() &&
        a !== cfg[asset].toLowerCase(),
    );
    const pins = await Promise.all(
      all.map((a) => codePin(c, getAddress(a), block)),
    );
    deployments.push({
      product,
      state: "deployed",
      chainId,
      deployedAtBlock: observed[name].block.toString(),
      vault: observed[name].pin,
      asset: await codePin(c, cfg[asset], block),
      dependencies: pins,
    });
  }
  for (const id of [1, 8453])
    if (
      (await clients[id].getBlock({ blockNumber: heads[id].number })).hash !==
      heads[id].hash
    )
      throw new Error("Finalized capture changed during verification");
  return { schema: 1, deployments };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [mode, input, output, receiptFile] = process.argv.slice(2);
    if (
      !["prepare", "preflight", "capture"].includes(mode) ||
      !input ||
      !output
    )
      throw new Error(
        "Usage: node scripts/vault-deployment.mjs prepare|preflight|capture input.json output.json [receipts.json]",
      );
    const compilation = compileContracts(),
      parsed = JSON.parse(readFileSync(input, "utf8"));
    if (
      mode !== "prepare" &&
      stringify(buildDeploymentPlan(parsed.config, compilation)) !==
        stringify(parsed)
    )
      throw new Error(
        "Deployment plan does not match current compilation/configuration",
      );
    const result =
      mode === "prepare"
        ? buildDeploymentPlan(parsed, compilation)
        : mode === "preflight"
          ? await preflight(parsed)
          : await captureManifest(
              parsed,
              JSON.parse(readFileSync(receiptFile, "utf8")),
              compilation,
            );
    writeFileSync(output, stringify(result) + "\n");
    console.log(
      `Saved ${mode} result. No transaction was signed or broadcast.`,
    );
  } catch (error) {
    console.error(
      (error.shortMessage ?? error.message ?? "Deployment check failed").split(
        "\n",
      )[0],
    );
    process.exitCode = 1;
  }
}
