import test from "node:test";
import assert from "node:assert/strict";
import { compileContracts } from "../scripts/compile-contracts.mjs";
import { createHarness } from "./contracts/evm.mjs";
import { createRoute } from "./contracts/route-fixture.mjs";
const compiled = compileContracts({ mocks: true });
const E = 10n ** 18n,
  U = 1_000_000n;
const zero = "0x0000000000000000000000000000000000000000";
async function fixture(borrowBps = 2000n, remote = false) {
  const h = await createHarness(compiled);
  const weth = await h.deploy("MockWETH"),
    usdc = await h.deploy("MockToken", [6]);
  const lender = await h.deploy("MockLending", [weth.address, usdc.address]);
  const aWeth = h.contract("MockAToken", await lender.read("aWeth"));
  const baseToken = remote ? await h.deploy("MockToken", [6]) : usdc;
  const usdcLender = await h.deploy("MockAave", [baseToken.address]);
  const native = await h.deploy("MockNative", [baseToken.address]);
  const base = await h.deploy("BaseUsdcVault", [
    baseToken.address,
    native.address,
    native.address,
    usdcLender.address,
    await usdcLender.read("aToken"),
    U,
  ]);
  const route = remote ? await createRoute(h, baseToken, usdc, base) : null;
  const ethFeed = await h.deploy("MockFeed", [2000n * 10n ** 8n]),
    usdcFeed = await h.deploy("MockFeed", [10n ** 8n]);
  const sequencer = await h.deploy("MockFeed", [0n]);
  const prices = await h.deploy("PriceGuard", [
    ethFeed.address,
    usdcFeed.address,
    sequencer.address,
    86_400n,
    3600n,
  ]);
  const router = await h.deploy("MockRouter", [usdc.address, weth.address]);
  const vault = await h.deploy("SharedEthVault", [
    [
      weth.address,
      usdc.address,
      lender.address,
      aWeth.address,
      await lender.read("variableDebt"),
      router.address,
      prices.address,
      500,
      route?.l1.address ?? base.address,
      remote ? 1 : 0,
      1n,
    ],
    [
      borrowBps,
      1000n,
      100_000n * U,
      (25n * E) / 10n,
      (18n * E) / 10n,
      100n,
      20n,
      3600n,
      E / 1000n,
    ],
    "Megapot Club Base Ether",
    "mcETH",
  ]);
  const position = h.contract("ServicePosition", await vault.read("position"));
  const waiting = h.contract("WaitingEscrow", await vault.read("waiting"));
  // Fund WETH's native backing so the fallback test exercises its actual unwrap path.
  await weth.call("deposit", [], h.alice, 100n * E);
  await weth.call("transfer", [h.bob, 10n * E]);
  for (const owner of [h.alice, h.bob])
    await weth.call("approve", [vault.address, 50n * E], owner);
  async function entry(amount, owner = h.alice) {
    return vault.call("requestDeposit", [amount, owner, false], owner);
  }
  async function bootstrap(amount = 10n * E) {
    await entry(amount);
    await vault.call("seal");
    await vault.call("prepare", [64n]);
    await vault.call("retrieveEntries");
    await vault.call("settle");
    await vault.call("claimEntry", [1n, h.alice, false]);
  }
  async function activateDownstream() {
    await base.call("processDeposits", [64n, 1_000_000n * U]);
    await native.call("settle", [E]);
    await position.call("claimDepositLot", [1n]);
    await position.call("closeRequest", [1n, true]);
  }
  async function drainNative(accumulator = E) {
    await position.call("startRedeem");
    await base.call("processRedeems", [64n, 1_000_000n * U]);
    await native.call("settle", [accumulator]);
    await position.call("claimExitLot", [1n]);
    await position.call("closeRequest", [1n, false]);
    await vault.call("collectDownstream");
    await vault.call("repayCash");
  }
  return {
    ...h,
    route,
    baseToken,
    weth,
    usdc,
    lender,
    aWeth,
    usdcLender,
    native,
    base,
    ethFeed,
    usdcFeed,
    sequencer,
    prices,
    router,
    vault,
    position,
    waiting,
    entry,
    bootstrap,
    activateDownstream,
    drainNative,
  };
}
test("one shared ETH pool fairly exchanges new entries and old exits only after actual debt-free realization", async () => {
  const h = await fixture();
  const {
    vault,
    position,
    lender,
    aWeth,
    bootstrap,
    activateDownstream,
    drainNative,
    entry,
    alice,
    bob,
  } = h;
  await bootstrap();
  await vault.call("leverage");
  await activateDownstream();
  assert.equal(await vault.read("debt"), 4000n * U);
  assert.equal(await vault.read("localUsdc"), 400n * U);
  await entry(2n * E, bob);
  await vault.call("requestRedeem", [4n * E, alice]);
  h.advance(3601);
  await aWeth.call("setIndex", [101n * 10n ** 25n]);
  await lender.call("accrue", [vault.address, 10n * U]);
  await vault.call("seal");
  await vault.call("prepare", [64n]);
  await vault.call("retrieveEntries");
  await assert.rejects(vault.call("settle"), /WrongState/);
  await drainNative((11n * E) / 10n); // 3960 USDC + reserve400 - debt4010 =350 surplus
  assert.equal(await vault.read("localUsdc"), 350n * U);
  assert.equal(await position.read("closed"), true);
  await vault.call("convertSurplus");
  await vault.call("retrieveCollateral");
  const oldAssets = (101n * E) / 10n + (175n * E) / 1000n;
  assert.equal(await vault.read("activeWeth"), oldAssets);
  await vault.call("settle");
  const expectedExit = (4n * oldAssets) / 10n;
  assert.equal(await vault.call("claimExit", [1n, alice, false]), expectedExit);
  const entryCash = (202n * E) / 100n;
  const expectedShares = (entryCash * (10n * E)) / oldAssets;
  assert.equal(
    await vault.call("claimEntry", [2n, bob, false], bob),
    expectedShares,
  );
  assert.equal(await vault.read("totalSupply"), 6n * E + expectedShares);
  assert.equal(await vault.read("reservedWeth"), 0n);
});
test("debt defense works locally while downstream is blocked, and cannot use entrants or fixed claims", async () => {
  const h = await fixture();
  const { vault, lender, ethFeed, router, waiting, entry, bootstrap, bob } = h;
  await bootstrap();
  await vault.call("leverage");
  await entry(2n * E, bob);
  await lender.call("setPrice", [700n * 10n ** 8n]);
  await ethFeed.call("set", [700n * 10n ** 8n, h.now()]);
  await router.call("setPrice", [700n * U]);
  const beforeUnits = await waiting.read("ownedUnits");
  const beforeHealth = await vault.read("health");
  await vault.call("defendWithFlash", [2000n * U, (288n * E) / 100n]);
  assert.equal(await vault.read("debt"), 1600n * U); // reserve400 and flash2000 repaid
  assert.ok((await vault.read("health")) > beforeHealth);
  assert.equal(await waiting.read("ownedUnits"), beforeUnits);
  assert.equal(await vault.read("localUsdc"), 0n);
  await assert.rejects(vault.call("leverage"), /WrongState/);
});
test("stale prices, sequencer downtime and forged flash callbacks fail closed", async () => {
  const h = await fixture();
  const {
    vault,
    bootstrap,
    ethFeed,
    sequencer,
    attacker,
    usdc,
    router,
    prices,
  } = h;
  await bootstrap();
  await ethFeed.call("set", [2000n * 10n ** 8n, h.now() - 86401n]);
  await assert.rejects(vault.call("leverage"), /InvalidOracle/);
  assert.equal(await vault.read("activeWeth"), 10n * E);
  await ethFeed.call("set", [2000n * 10n ** 8n, h.now()]);
  await sequencer.call("set", [1n, h.now()]);
  await assert.rejects(vault.call("leverage"), /InvalidOracle/);
  await sequencer.call("set", [0n, h.now()]);
  await sequencer.call("setStarted", [h.now() - 100n]);
  await assert.rejects(prices.read("prices"), /InvalidOracle/);
  await sequencer.call("setStarted", [h.now() - 4000n]);
  await vault.call("leverage");
  await assert.rejects(
    vault.call(
      "executeOperation",
      [usdc.address, 1n, 0n, attacker, "0x"],
      attacker,
    ),
    /Unauthorized/,
  );
});
test("the last holder can exit all assets; rejected Ether delivery automatically preserves a WETH payment", async () => {
  const h = await fixture(0n);
  const { vault, bootstrap, alice, weth, deploy } = h;
  await bootstrap();
  await vault.call("leverage");
  await vault.call("requestRedeem", [10n * E, alice]);
  h.advance(3601);
  await vault.call("seal");
  await vault.call("prepare", [64n]);
  await vault.call("retrieveCollateral");
  await vault.call("settle");
  const rejecting = await deploy("RejectEther");
  assert.equal(
    await vault.call("claimExit", [1n, rejecting.address, true]),
    10n * E,
  );
  assert.equal(await weth.read("balanceOf", [rejecting.address]), 10n * E);
  assert.equal(await vault.read("totalSupply"), 0n);
  assert.equal(await vault.read("activeWeth"), 0n);
  assert.equal(await vault.read("reservedWeth"), 0n);
});
test("sub-USDC residual interest debt has a complete collateral-funded exit path", async () => {
  const h = await fixture();
  const { vault, lender, bootstrap, activateDownstream, drainNative, alice } =
    h;
  await bootstrap();
  await vault.call("leverage");
  await activateDownstream();
  await vault.call("requestRedeem", [10n * E, alice]);
  h.advance(3601);
  await vault.call("seal");
  await vault.call("prepare", [64n]);
  await lender.call("accrue", [vault.address, 100n]);
  await drainNative();
  assert.equal(await vault.read("debt"), 100n);
  // Flash due101 raw USDC; a fresh fixed-price cap with <=1% slippage.
  await vault.call("defendWithFlash", [100n, 51n * 10n ** 9n]);
  assert.equal(await vault.read("debt"), 0n);
  await vault.call("retrieveCollateral");
  await vault.call("settle");
  assert.ok((await vault.call("claimExit", [1n, alice, false])) > 9n * E);
});
test("registered closure ignores unsolicited controller requests and transferred receipt donations", async () => {
  const h = await fixture(0n);
  const { vault, base, position, usdc, bootstrap, alice, attacker } = h;
  await bootstrap();
  await vault.call("leverage");
  await usdc.call("mint", [attacker, 100n * U]);
  await usdc.call("approve", [base.address, 100n * U], attacker);
  await base.call("requestDeposit", [10n * U, position.address], attacker);
  assert.equal(await base.read("exposureClosed", [position.address]), false);
  assert.equal(await position.read("closed"), true);
  await assert.rejects(position.call("cancelDeposit", [1n]), /WrongState/);
  await vault.call("requestRedeem", [10n * E, alice]);
  h.advance(3601);
  await vault.call("seal");
  await vault.call("prepare", [64n]);
  await vault.call("retrieveCollateral");
  await vault.call("settle");
  assert.equal(await vault.call("claimExit", [1n, alice, false]), 10n * E);
});
test("entry cancellation, bounded sealing and fixed old claims survive unrelated future failures", async () => {
  const h = await fixture(0n);
  const { vault, entry, bootstrap, alice, bob, weth, lender } = h;
  await bootstrap();
  await entry(E, bob);
  await entry(E, bob);
  await vault.call("cancelEntry", [2n], bob);
  await vault.call("claimCancelledEntry", [2n, bob, false], bob);
  await vault.call("requestRedeem", [2n * E, alice]);
  h.advance(3601);
  await vault.call("seal");
  await vault.call("prepare", [1n]);
  await assert.rejects(vault.call("settle"), /WrongState/);
  await vault.call("prepare", [64n]);
  await vault.call("retrieveEntries");
  await vault.call("settle");
  await vault.call("leverage");
  await lender.call("setPaused", [true]);
  const before = await weth.read("balanceOf", [alice]);
  await vault.call("claimExit", [1n, alice, false]);
  assert.equal((await weth.read("balanceOf", [alice])) - before, 2n * E);
  assert.equal(await vault.call("claimEntry", [3n, bob, false], bob), E);
});
test("oracle-priced dust conversion clears a one-unit surplus induced by third-party debt repayment", async () => {
  const h = await fixture();
  const {
    vault,
    lender,
    usdc,
    weth,
    bootstrap,
    activateDownstream,
    drainNative,
    alice,
    keeper,
  } = h;
  await bootstrap();
  await vault.call("leverage");
  await activateDownstream();
  await usdc.call("mint", [keeper, 1n]);
  await usdc.call("approve", [lender.address, 1n], keeper);
  await lender.call("repay", [usdc.address, 1n, 2n, vault.address], keeper);
  await vault.call("requestRedeem", [10n * E, alice]);
  h.advance(3601);
  await vault.call("seal");
  await vault.call("prepare", [64n]);
  await drainNative();
  assert.equal(await vault.read("localUsdc"), 1n);
  await weth.call("approve", [vault.address, E]);
  assert.deepEqual(await vault.call("buyDust", [1n, E]), [1n, 500_000_000n]);
  await vault.call("retrieveCollateral");
  await vault.call("settle");
  assert.equal(
    await vault.call("claimExit", [1n, alice, false]),
    10n * E + 500_000_000n,
  );
});
test("emergency drain does not require a user request, and stalled incumbents cannot hold entrants hostage", async () => {
  const h = await fixture();
  const {
    vault,
    lender,
    ethFeed,
    bootstrap,
    entry,
    alice,
    bob,
    position,
    weth,
  } = h;
  await bootstrap();
  await vault.call("leverage");
  await entry(E, bob);
  await lender.call("setPrice", [600n * 10n ** 8n]);
  await ethFeed.call("set", [600n * 10n ** 8n, h.now()]);
  await vault.call("emergencySeal");
  assert.equal(await position.read("draining"), true);
  await vault.call("prepare", [64n]);
  await vault.call("retrieveEntries");
  await assert.rejects(vault.call("abortEntries"), /WrongState/);
  h.advance(2 * 86400 + 1);
  await vault.call("abortEntries");
  await vault.call("releaseAbortedEntries");
  const before = await weth.read("balanceOf", [bob]);
  assert.equal(await vault.call("claimEntry", [2n, bob, false], bob), E);
  assert.equal((await weth.read("balanceOf", [bob])) - before, E);
  assert.equal(await vault.read("debt"), 4000n * U);
  assert.equal(await vault.read("totalSupply"), 10n * E);
  assert.equal(await vault.read("reservedWeth"), 0n);
  await assert.rejects(vault.call("settle"), /WrongState/);
});
test("total collateral loss is terminal and refunds new owners without diluting old loss ownership", async () => {
  const h = await fixture(0n);
  const { vault, lender, bootstrap, entry, alice, bob } = h;
  await bootstrap();
  await vault.call("leverage");
  await entry(E, bob);
  await lender.call("liquidate", [vault.address, 10n * E, 0n]);
  await vault.call("requestRedeem", [5n * E, alice]);
  h.advance(3601);
  await vault.call("seal");
  await vault.call("prepare", [64n]);
  await vault.call("retrieveEntries");
  await vault.call("retrieveCollateral");
  await vault.call("settle");
  assert.equal(await vault.read("phase"), 2);
  assert.equal(await vault.call("claimEntry", [2n, bob, false], bob), E);
  assert.equal(await vault.call("claimExit", [1n, alice, false]), 0n);
  await vault.call("burnWorthless", [5n * E]);
  assert.equal(await vault.read("totalSupply"), 0n);
  await assert.rejects(entry(E), /WrongState/);
});
test("router slippage failure rolls back a flash defense that actually reaches the swap", async () => {
  const h = await fixture();
  const { vault, router, bootstrap, alice } = h;
  await bootstrap();
  await vault.call("leverage");
  await vault.call("requestRedeem", [E, alice]);
  h.advance(3601);
  await vault.call("seal");
  const oldDebt = await vault.read("debt"),
    oldUnits = await vault.read("collateralUnits"),
    oldReserve = await vault.read("localUsdc");
  await router.call("setSpread", [500n]);
  // With a valid oracle cap, 5% execution spread exceeds the 1% configured limit and the router itself reverts.
  await assert.rejects(
    vault.call("defendWithFlash", [1000n * U, (505n * E) / 1000n]),
    /revert: 0x/,
  );
  assert.equal(await vault.read("debt"), oldDebt);
  assert.equal(await vault.read("collateralUnits"), oldUnits);
  assert.equal(await vault.read("localUsdc"), oldReserve);
  await router.call("setSpread", [0n]);
  await vault.call("defendWithFlash", [1000n * U, (505n * E) / 1000n]);
  assert.equal(await vault.read("debt"), 2600n * U);
});
test("sealed entrants can recover aWETH in kind while both incumbent realization and waiting liquidity are blocked", async () => {
  const h = await fixture();
  const { vault, lender, bootstrap, entry, bob, aWeth } = h;
  await bootstrap();
  await vault.call("leverage");
  await entry(E, bob);
  h.advance(3601);
  await vault.call("seal");
  await vault.call("prepare", [64n]);
  await lender.call("setPaused", [true]);
  await assert.rejects(vault.call("retrieveEntries"));
  h.advance(2 * 86400 + 1);
  await vault.call("abortEntries");
  await vault.call("releaseAbortedInKind");
  const before = await aWeth.read("scaledBalanceOf", [bob]);
  assert.deepEqual(
    await vault.call("claimAbortedInKind", [2n, bob, false], bob),
    [0n, 0n],
  );
  assert.equal(await vault.read("refundUnitsRemaining", [2n]), E);
  const [cash, lenderAmount] = await vault.call(
    "claimAbortedInKind",
    [2n, bob, true],
    bob,
  );
  assert.equal(cash, 0n);
  assert.equal(lenderAmount, E);
  assert.equal((await aWeth.read("scaledBalanceOf", [bob])) - before, E);
  await assert.rejects(
    vault.call("claimAbortedInKind", [2n, bob, true], bob),
    /WrongState/,
  );
  await assert.rejects(vault.call("settle"), /WrongState/);
  assert.equal(await vault.read("debt"), 4000n * U);
});

test("Ethereum ETH traverses the real local service/CCTP/inbox composition and waits for every return frontier", async () => {
  const h = await fixture(2000n, true);
  const { vault, position, base, native, usdc, bootstrap, alice, attacker } = h;
  const { l1, inbox, l1Transmitter, baseTransmitter, relay } = h.route;
  await bootstrap();
  await vault.call("leverage");
  await l1.call("bridgeDeposit", [1n]);
  await relay(l1Transmitter, inbox, 0, true);
  await inbox.call("invest", [1n]);
  await base.call("processDeposits", [64n, 10_000n * U]);
  await native.call("settle", [E]);
  await inbox.call("claimDepositLot", [1n]);
  await inbox.call("closeOperation", [1n]);
  await relay(baseTransmitter, l1, 1); // Closure arrives before activation.
  await assert.rejects(position.call("closeRequest", [1n, true]), /WrongState/);
  await relay(baseTransmitter, l1, 0);
  await position.call("collectRemote", [1n, true]);
  await position.call("closeRequest", [1n, true]);
  assert.equal(await position.read("ownedShares"), 3600n * U);
  // An unsolicited source operation is not one of the strategy's registered obligations.
  await usdc.call("mint", [attacker, U]);
  await usdc.call("approve", [l1.address, U], attacker);
  await l1.call("requestDeposit", [U, position.address], attacker);
  await vault.call("requestRedeem", [10n * E, alice]);
  h.advance(3601);
  await vault.call("seal");
  await vault.call("prepare", [64n]);
  const redeem = await position.call("startRedeem");
  assert.equal(redeem, 3n);
  await relay(l1Transmitter, inbox, 1);
  await inbox.call("startRedeem", [redeem]);
  await base.call("processRedeems", [64n, 10_000n * U]);
  await native.call("settle", [E]);
  await inbox.call("claimExitLot", [1n]);
  await inbox.call("closeRedeem", [1n]);
  await inbox.call("returnCash", [redeem, 10_000n * U]);
  await inbox.call("closeOperation", [redeem]);
  await relay(baseTransmitter, l1, 3); // Return closure cannot stand in for actual mint.
  await assert.rejects(
    position.call("closeRequest", [redeem, false]),
    /WrongState/,
  );
  await assert.rejects(vault.call("settle"), /WrongState/);
  await relay(baseTransmitter, l1, 2, true);
  await position.call("collectRemote", [redeem, false]);
  await position.call("closeRequest", [redeem, false]);
  await vault.call("collectDownstream");
  await vault.call("repayCash");
  await vault.call("retrieveCollateral");
  assert.equal(await position.read("closed"), true);
  assert.equal(await l1.read("exposureClosed", [position.address]), false);
  await vault.call("settle");
  assert.equal(await vault.call("claimExit", [1n, alice, false]), 10n * E);
  assert.equal(await vault.read("totalSupply"), 0n);
  assert.equal(await vault.read("debt"), 0n);
});

test("authenticated remote STOP permits an Ethereum ETH emergency seal and forbids re-leveraging", async () => {
  const h = await fixture(0n, true);
  const { vault, native, bootstrap, position } = h;
  const { inbox, baseTransmitter, l1, relay } = h.route;
  await bootstrap();
  await vault.call("leverage");
  await native.call("setEmergency", [true]);
  await inbox.call("announceStop");
  await relay(baseTransmitter, l1, 0);
  assert.equal(await position.read("upstreamStopped"), true);
  await vault.call("emergencySeal");
  await vault.call("prepare", [64n]);
  await vault.call("retrieveCollateral");
  await vault.call("settle");
  await assert.rejects(vault.call("leverage"), /WrongState/);
  await assert.rejects(h.entry(E), /WrongState/);
});
