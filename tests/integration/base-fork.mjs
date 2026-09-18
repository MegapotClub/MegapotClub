/** Read-only RPC-backed local EVM. All deployments, impersonation and asset movement exist only in memory. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";
import { RPCStateManager } from "@ethereumjs/statemanager";
import { createCustomCommon, Mainnet, Hardfork } from "@ethereumjs/common";
import { createHarness } from "../contracts/evm.mjs";
const url = process.env.CLUB_BASE_RPC;
if (!url || new URL(url).protocol !== "https:")
  throw new Error(
    "Set CLUB_BASE_RPC to a Base HTTPS endpoint with historical eth_getProof support",
  );
const c = createPublicClient({
  ccipRead: false,
  transport: http(url, { timeout: 20000, retryCount: 1 }),
});
assert.equal(await c.getChainId(), 8453);
const head = process.env.CLUB_FORK_BLOCK
  ? await c.getBlock({ blockNumber: BigInt(process.env.CLUB_FORK_BLOCK) })
  : await c.getBlock();
const config = JSON.parse(
    readFileSync("deployment/config.proposed.json", "utf8"),
  ),
  cfg = config.chains[8453];
const compiled = JSON.parse(
  readFileSync(".contract-build/artifacts.json", "utf8"),
);
compiled.contracts.Token = {
  abi: parseAbi([
    "function transfer(address,uint256) returns (bool)",
    "function approve(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function deposit() payable",
  ]),
};
const common = createCustomCommon({ chainId: 8453 }, Mainnet, {
  hardfork: Hardfork.Cancun,
});
const stateManager = new RPCStateManager({
  provider: url,
  blockTag: head.number,
  common,
});
const h = await createHarness(compiled, {
  common,
  stateManager,
  timestamp: head.timestamp,
  blockNumber: head.number,
});
console.log("Local Base fork", head.number.toString(), head.hash);
const token = h.contract("Token", cfg.usdc),
  weth = h.contract("Token", cfg.weth);
const base = await h.deploy("BaseUsdcVault", [
  cfg.usdc,
  config.native.jackpot,
  config.native.manager,
  cfg.pool,
  cfg.aUsdc,
  1_000_000n,
]);
// Local impersonation seeds a fixture. This never submits anything to the public network.
await token.call("transfer", [h.alice, 100_000_000n], cfg.aUsdc);
await token.call("approve", [base.address, 100_000_000n]);
await base.call("requestDeposit", [100_000_000n, h.alice]);
assert.ok((await base.read("waitingUnitsOf", [h.alice])) > 0n);
h.advance(60);
await base.call("cancelDeposit", [1n]);
await base.call("claimCancelled", [1n, h.alice, false]);
assert.ok((await token.read("balanceOf", [h.alice])) >= 99_999_998n);
assert.equal(await base.read("waitingUnitsOf", [h.alice]), 0n);
console.log("Actual Aave USDC waiting/deposit/cancel/withdraw passed");
const guard = await h.deploy("PriceGuard", [
  cfg.ethFeed,
  cfg.usdcFeed,
  cfg.sequencer,
  BigInt(cfg.feedMaxAge),
  BigInt(cfg.sequencerGrace),
]);
const risk = [
  "borrowBps",
  "reserveBps",
  "maxDebt",
  "minimumHealth",
  "defenseHealth",
  "slippageBps",
  "flashPremiumBps",
  "period",
  "minimumDeposit",
].map((k) => BigInt(cfg.risk[k]));
risk[7] = 3600n; // The one-hour local test period is not the proposed one-day launch period.
const vault = await h.deploy("SharedEthVault", [
  [
    cfg.weth,
    cfg.usdc,
    cfg.pool,
    cfg.aWeth,
    cfg.variableDebt,
    cfg.router,
    guard.address,
    Number(cfg.swapFee),
    base.address,
    0,
    8453n,
  ],
  risk,
  "Megapot Club Base Ether",
  "mcETH",
]);
const pos = h.contract("ServicePosition", await vault.read("position"));
const E = 10n ** 18n;
await vault.call("requestDeposit", [E, h.alice, true], h.alice, E);
await vault.call("seal");
await vault.call("prepare", [64n]);
await vault.call("retrieveEntries");
await vault.call("settle");
await vault.call("claimEntry", [1n, h.alice, false]);
const shares = await vault.read("balanceOf", [h.alice]);
assert.ok(shares > 0n);
await vault.call("leverage");
assert.ok((await vault.read("debt")) > 0n);
console.log("Actual Aave WETH collateral and USDC debt opened");
await vault.call("requestRedeem", [shares, h.alice]);
h.advance(3601);
await vault.call("seal");
await vault.call("prepare", [64n]);
const registeredId = (await base.read("nextDeposit")) - 1n;
await pos.call("cancelDeposit", [registeredId]);
await pos.call("retrieveWaiting", [registeredId]);
await pos.call("closeRequest", [registeredId, true]);
await vault.call("collectDownstream");
await vault.call("repayCash");
const remaining = await vault.read("debt");
if (remaining > 0n) {
  const due =
    remaining + (remaining * BigInt(cfg.risk.flashPremiumBps) + 9999n) / 10000n;
  const quote = await guard.read("usdcToEth", [due, 1]);
  const cap =
    (quote * 10000n + (10000n - BigInt(cfg.risk.slippageBps)) - 1n) /
    (10000n - BigInt(cfg.risk.slippageBps));
  await vault.call("defendWithFlash", [remaining, cap]);
}
assert.equal(await vault.read("debt"), 0n);
const surplus = await vault.read("localUsdc");
if (surplus > 0n) await vault.call("convertSurplus");
await vault.call("retrieveCollateral");
await vault.call("settle");
const received = await vault.call("claimExit", [1n, h.alice, false]);
assert.ok(received > (9n * E) / 10n);
assert.equal(await vault.read("totalSupply"), 0n);
assert.equal(await pos.read("closed"), true);
assert.equal((await c.getBlock({ blockNumber: head.number })).hash, head.hash);
const evidence = {
  kind: "local-rpc-backed-EVM",
  chainId: 8453,
  block: head.number.toString(),
  blockHash: head.hash,
  timestamp: head.timestamp.toString(),
  inputHash: compiled.inputHash,
  fixturePeriod: "3600",
  shares: shares.toString(),
  remainingDebtBeforeDefense: remaining.toString(),
  received: received.toString(),
  gas: h.gas,
  scope:
    "Actual Aave/USDC/WETH/feed/router dependency execution; local Base vault waiting and ETH debt lifecycle. No native draw settlement, Circle attestation, external transaction or financial deployment.",
};
writeFileSync(
  ".contract-build/base-fork-evidence.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  "Actual Aave debt repaid, collateral realized, full final-holder exit passed",
);
