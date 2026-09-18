import { test } from "node:test";
import assert from "node:assert/strict";
import { walletConfig } from "../src/walletConfig.ts";

test("the actual production wallet configuration is keyless and excludes WalletConnect", () => {
  assert.ok(
    walletConfig.connectors.some(
      (connector) => connector.type === "coinbaseWallet",
    ),
  );
  assert.ok(
    walletConfig.connectors.every((connector) =>
      ["coinbaseWallet", "injected"].includes(connector.type),
    ),
  );
  assert.equal(
    walletConfig.connectors.some((connector) =>
      /walletconnect/i.test(connector.id),
    ),
    false,
  );
  assert.deepEqual(
    walletConfig.chains.map((chain) => chain.id),
    [8453, 1],
  );
  assert.equal(walletConfig.state.status, "disconnected");
  assert.equal(walletConfig.getClient({ chainId: 1 }).ccipRead, false);
  assert.equal(walletConfig.getClient({ chainId: 8453 }).ccipRead, false);
});
