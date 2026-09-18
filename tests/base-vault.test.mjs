import test from "node:test";
import assert from "node:assert/strict";
import { compileContracts } from "../scripts/compile-contracts.mjs";
import { createHarness } from "./contracts/evm.mjs";

const compiled = compileContracts({ mocks: true });
const U = 1_000_000n,
  P = 10n ** 18n,
  RAY = 10n ** 27n;
async function fixture() {
  const h = await createHarness(compiled);
  const token = await h.deploy("MockToken", [6]);
  const aave = await h.deploy("MockAave", [token.address]);
  const aToken = h.contract("MockAToken", await aave.read("aToken"));
  const native = await h.deploy("MockNative", [token.address]);
  const vault = await h.deploy("BaseUsdcVault", [
    token.address,
    native.address,
    native.address,
    aave.address,
    aToken.address,
    1n,
  ]);
  const waiting = h.contract("WaitingEscrow", await vault.read("waiting"));
  for (const owner of [h.alice, h.bob, h.carol]) {
    await token.call("mint", [owner, 1_000_000n * U]);
    await token.call("approve", [vault.address, 1_000_000n * U], owner);
  }
  async function deposit(assets, owner = h.alice) {
    return vault.call("requestDeposit", [assets, owner], owner);
  }
  async function active(assets, owner = h.alice) {
    await deposit(assets, owner);
    await vault.call("processDeposits", [64n, assets]);
    await native.call("settle", [P]);
    await vault.call(
      "claimDeposit",
      [(await vault.read("nextDepositLot")) - 1n, owner],
      owner,
    );
  }
  return { ...h, token, aave, aToken, native, vault, waiting, deposit, active };
}

test("separate keeper budgets pay bounded economic progress once and preserve owner refunds", async () => {
  const h = await fixture();
  const { vault, native, deposit, alice, bob, keeper, attacker } = h;
  const budget = await h.deploy("KeeperBudget", [
    vault.address,
    "0x0000000000000000000000000000000000000000",
  ]);
  const tip = 10n ** 12n;
  await budget.call("fund", [tip, h.now() + 3600n], alice, 10n * tip);
  assert.equal(await budget.call("runVault", [0, 1n], keeper), false);
  assert.equal(await budget.read("rewards", [keeper]), 0n);
  await deposit(100n * U);
  await deposit(100n * U, bob);
  await native.call("setCapacity", [100n * U, 0n]);
  await budget.call("runVault", [0, 0n], attacker);
  assert.equal(await budget.read("rewards", [attacker]), 0n);
  await native.call("setCapacity", [1000n * U, 0n]);
  await budget.call("runVault", [0, 1n], keeper);
  assert.equal(await budget.read("rewards", [keeper]), tip); // An invalid budget cannot consume the paid-progress identity.
  await budget.call("runVault", [0, 1n], keeper);
  assert.equal(await budget.read("rewards", [keeper]), tip);
  await assert.rejects(budget.call("runVault", [4, 1n], keeper));
  assert.equal((await budget.read("budgets", [1n]))[1], 9n * tip);
  await native.call("settle", [P]);
  await budget.call("runVault", [2, 1n], keeper);
  assert.equal(await budget.read("rewards", [keeper]), 2n * tip);
  await assert.rejects(
    budget.call("withdrawBudget", [1n, tip, attacker], attacker),
    /InvalidBudget/,
  );
  await budget.call("withdrawBudget", [1n, 8n * tip, alice]);
  assert.equal(await budget.call("claimReward", [keeper], keeper), 2n * tip);
  assert.equal(await budget.read("rewards", [keeper]), 0n);
  assert.equal(await vault.read("totalSupply"), 200n * U);
});

test("waiting yield belongs to actual scaled-unit owners, including staggered deposits and donations", async () => {
  const { token, aToken, vault, waiting, deposit, alice, bob } =
    await fixture();
  await deposit(100n * U);
  await aToken.call("setIndex", [2n * RAY]);
  await deposit(100n * U, bob);
  assert.equal(await vault.read("waitingUnitsOf", [alice]), 100n * U);
  assert.equal(await vault.read("waitingUnitsOf", [bob]), 50n * U);
  await token.call("mint", [waiting.address, 17n * U]);
  await aToken.call("donateUnits", [waiting.address, 9n * U]);
  const beforeA = await token.read("balanceOf", [alice]),
    beforeB = await token.read("balanceOf", [bob]);
  await vault.call("cancelDeposit", [1n]);
  await vault.call("claimCancelled", [1n, alice, false]);
  await vault.call("cancelDeposit", [2n], bob);
  await vault.call("claimCancelled", [2n, bob, false], bob);
  assert.equal((await token.read("balanceOf", [alice])) - beforeA, 200n * U);
  assert.equal((await token.read("balanceOf", [bob])) - beforeB, 100n * U);
  assert.equal(await waiting.read("ownedUnits"), 0n);
  assert.equal(await aToken.read("scaledBalanceOf", [waiting.address]), 9n * U);
  assert.equal(await token.read("balanceOf", [waiting.address]), 17n * U);
});
test("FIFO partial fill retains head; failed native or lender calls roll every debit back", async () => {
  const { vault, native, aave, waiting, deposit, alice, bob, aToken } =
    await fixture();
  await deposit(100n * U);
  await deposit(20n * U, bob);
  await native.call("setCapacity", [30n * U, 0n]);
  await vault.call("processDeposits", [64n, 1_000n * U]);
  assert.equal(await vault.read("depositHead"), 1n);
  assert.equal(await vault.read("waitingUnitsOf", [alice]), 70n * U);
  assert.equal(await vault.read("waitingUnitsOf", [bob]), 20n * U);
  await native.call("setCapacity", [1000n * U, 0n]);
  await native.call("setLocked", [true]);
  await assert.rejects(vault.call("processDeposits", [64n, 20n * U]));
  assert.equal(await waiting.read("ownedUnits"), 90n * U);
  await native.call("setLocked", [false]);
  await aave.call("setShortReturn", [true]);
  await assert.rejects(
    vault.call("processDeposits", [64n, 20n * U]),
    /InexactMovement/,
  );
  assert.equal(
    await aToken.read("scaledBalanceOf", [waiting.address]),
    90n * U,
  );
  await aave.call("setShortReturn", [false]);
  await aave.call("setIlliquid", [true]);
  await vault.call("cancelDeposit", [1n]);
  await assert.rejects(vault.call("claimCancelled", [1n, alice, false]));
  await vault.call("claimCancelled", [1n, alice, true]);
  assert.equal(await aToken.read("balanceOf", [alice]), 70n * U);
});
test("aggregate deposit rounding allocates every share once, with no claim-time repricing", async () => {
  const { vault, native, deposit, alice, bob } = await fixture();
  await deposit(100n * U);
  await deposit(100n * U, bob);
  await vault.call("processDeposits", [64n, 200n * U]);
  await native.call("settle", [(15n * P) / 10n]);
  // Before materialization, old receipt supply/NAV must not acquire the pending cohort's backing.
  assert.equal(await vault.read("activeAssets"), 0n);
  await vault.call("syncDeposits");
  const q = (200n * U * P) / ((15n * P) / 10n);
  assert.equal(await vault.read("totalSupply"), q);
  assert.equal(await vault.read("earnedEscrowShares"), q);
  const b = await vault.call("claimDeposit", [2n, bob], bob);
  await native.call("settle", [2n * P]);
  const a = await vault.call("claimDeposit", [1n, alice]);
  assert.equal(a + b, q);
  assert.equal(a, q / 2n);
  assert.equal(b, q - q / 2n);
  assert.equal(
    await native.read("getLPShares", [vault.address]),
    await vault.read("totalSupply"),
  );
  await assert.rejects(vault.call("claimDeposit", [1n, alice]), /NotReady/);
});
test("transferable receipts and partial exits preserve fixed claims through a complete withdrawal", async () => {
  const { vault, native, token, active, alice, bob } = await fixture();
  await active(200n * U);
  await vault.call("transfer", [bob, 80n * U]);
  await vault.call("requestRedeem", [120n * U, alice]);
  await vault.call("requestRedeem", [80n * U, bob], bob);
  await vault.call("processRedeems", [64n, 150n * U]);
  assert.equal(await vault.read("lockedSharesOf", [bob]), 50n * U);
  await vault.call("processRedeems", [64n, 50n * U]);
  assert.equal(await vault.read("totalSupply"), 0n);
  await native.call("settle", [(9n * P) / 10n]);
  await vault.call("syncExits");
  assert.equal(await vault.read("reservedCash"), 180n * U);
  await native.call("settle", [3n * P]);
  const before = await token.read("balanceOf", [bob]);
  assert.equal(await vault.read("nextExitLot"), 3n); // Bob's consecutive partial fills merge into one fixed interval.
  await vault.call("claimExit", [2n, bob], bob);
  await vault.call("claimExit", [1n, alice]);
  assert.equal((await token.read("balanceOf", [bob])) - before, 72n * U);
  assert.equal(await vault.read("reservedCash"), 0n);
  assert.equal(await vault.read("exposureClosed", [alice]), true);
  assert.equal(await vault.read("exposureClosed", [bob]), true);
});
test("native emergency keeps new pending cash, earned shares, exits and old fixed claims separate", async () => {
  const { vault, native, deposit, active, alice, bob, carol } = await fixture();
  await active(200n * U);
  await vault.call("requestRedeem", [50n * U, alice]);
  await vault.call("processRedeems", [64n, 50n * U]);
  await native.call("settle", [(8n * P) / 10n]);
  await vault.call("syncExits"); // 40 fixed
  await deposit(100n * U, bob);
  await vault.call("processDeposits", [64n, 100n * U]);
  await native.call("settle", [P]); // Bob earns 100 shares, deliberately unmaterialized.
  await vault.call("requestRedeem", [100n * U, alice]);
  await vault.call("processRedeems", [64n, 100n * U]);
  await deposit(77n * U, carol);
  await vault.call("processDeposits", [64n, 77n * U]);
  await native.call("setEmergency", [true]);
  await vault.call("recoverNative");
  assert.equal(await vault.read("reservedCash"), 367n * U); // active150 + exit100 + refund77 + earlier40
  assert.equal(await vault.call("claimDeposit", [3n, carol], carol), 77n * U);
  await vault.call("claimDeposit", [2n, bob], bob);
  assert.equal(
    await vault.call("redeemRecovered", [100n * U, bob], bob),
    100n * U,
  );
  assert.equal(await vault.call("redeemRecovered", [50n * U, alice]), 50n * U);
  assert.equal(await vault.call("claimExit", [2n, alice]), 100n * U);
  assert.equal(await vault.call("claimExit", [1n, alice]), 40n * U);
  assert.equal(await vault.read("reservedCash"), 0n);
});
test("zero earned shares and zero-cash exits complete rather than locking a request forever", async () => {
  const { vault, native, deposit, alice } = await fixture();
  await deposit(1n);
  await vault.call("processDeposits", [1n, 1n]);
  await native.call("settle", [2n * P]);
  assert.equal(await vault.call("claimDeposit", [1n, alice]), 0n);
  assert.equal(await vault.read("exposureClosed", [alice]), true);
  await deposit(2n);
  await vault.call("processDeposits", [1n, 2n]);
  await native.call("settle", [2n * P]);
  await vault.call("claimDeposit", [2n, alice]);
  await vault.call("requestRedeem", [1n, alice]);
  await vault.call("processRedeems", [1n, 1n]);
  await native.call("settle", [1n]);
  await vault.call("syncExits");
  assert.equal(await vault.call("claimExit", [1n, alice]), 0n);
  assert.equal(await vault.read("exposureClosed", [alice]), true);
});
test("operator authorization, cancellation ownership, bounds and donation isolation", async () => {
  const { vault, token, waiting, deposit, alice, attacker } = await fixture();
  await deposit(10n * U);
  await token.call("mint", [vault.address, 123n * U]);
  await assert.rejects(
    vault.call("cancelDeposit", [1n], attacker),
    /Unauthorized/,
  );
  await assert.rejects(
    vault.call("processDeposits", [65n, 10n * U]),
    /WorkLimit/,
  );
  await vault.call("setOperator", [attacker, true]);
  await vault.call("cancelDeposit", [1n], attacker);
  await vault.call("setOperator", [attacker, false]);
  await assert.rejects(
    vault.call("claimCancelled", [1n, attacker, false], attacker),
    /Unauthorized/,
  );
  await vault.call("claimCancelled", [1n, alice, false]);
  assert.equal(await token.read("balanceOf", [vault.address]), 123n * U);
  assert.equal(await waiting.read("ownedUnits"), 0n);
  assert.equal(
    await token.read("allowance", [
      waiting.address,
      await waiting.read("pool"),
    ]),
    0n,
  );
});
