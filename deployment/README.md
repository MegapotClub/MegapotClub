# Four-vault launch package

This package prepares and verifies an original, immutable shared-vault deployment. **No financial contracts have been deployed or activated.** The portal keeps all four products explicitly undeployed. Existing native LP and account recovery remain available.

## Decisions before capital

The implemented ETH design is a perpetual shared pool with periodic **full realization**: all registered downstream exposure closes, all debt is repaid and actual WETH is recovered before entry and exit prices are fixed. Accept its latency, lost pool capacity and repeated borrow/swap/bridge/gas costs, or fund a separately reviewed continuous valuation design. Do not deploy and silently change the product later.

`config.proposed.json` contains actual dependency addresses and captured runtime/proxy/feed identities, plus proposed immutable parameters. It deliberately leaves both deployer addresses and starting nonces null. Its risk values are a review proposal, not a calibrated or approved investment policy:

| Parameter               | Proposed value on both chains                                        |
| ----------------------- | -------------------------------------------------------------------- |
| Borrowing               | 20% of fresh collateral value, up to 100,000 USDC                    |
| Local USDC reserve      | 10% of borrowed USDC                                                 |
| Minimum starting health | 2.5                                                                  |
| Local defense threshold | 1.8                                                                  |
| Swap slippage bound     | 1%                                                                   |
| Flash premium ceiling   | 0.20%                                                                |
| Realization period      | 1 day; completion can take much longer                               |
| Minimum Ether entry     | 0.001 Ether                                                          |
| Minimum Base USDC entry | 1 USDC                                                               |
| CCTP chunk ceiling      | 100,000 USDC, finalized threshold 2000, zero transport fee allowance |

Before financial deployment, complete independent economic review, actual-provider fork execution, full native draw lifecycle, real Circle attestation round trips and operational/small-capital acceptance. This package does not assert audited production readiness. No financed keeper availability or bounded exit time is promised.

## Reproducible preparation

Use the pinned Node/npm toolchain and lockfile. Tests execute local EVM calls; they never broadcast. The deployment CLI freshly compiles current source, including resolved OpenZeppelin content in its source identity, on every invocation.

```sh
npm ci
npm run check
npm run contracts:build
node scripts/sync-vault-abi.mjs
```

Copy the proposed configuration outside `public/`, enter the reviewed deploying EOAs and their exact pending nonces, review every immutable value and dependency, then prepare exact unsigned creation transactions:

```sh
node scripts/vault-deployment.mjs prepare deployment/config.reviewed.json .contract-build/plan.json
node scripts/vault-deployment.mjs preflight .contract-build/plan.json .contract-build/preflight.json
```

Set `CLUB_BASE_RPC` and `CLUB_ETHEREUM_RPC` to your HTTPS RPC endpoints in the invoking environment. The tools never print or persist those URLs. No signing key is accepted. The preflight checks chain/nonce, dependency code/implementation/feed targets, reserve links and precision, fresh prices, sequencer grace, Aave borrow/flash availability and premium, swap-pool liquidity, Circle transmitter/domain/peer/minter/burn ceiling, and native pool identity/emergency state. Supply/borrow capacity, future oracle service, fee-policy changes and slippage under a real trade remain dynamic execution conditions.

The ordered plan uses CREATE nonces, including a fixed mutually authenticated Ethereum-source/Base-inbox pair. It checks runtime and full initcode limits, including constructor arguments. Follow the exact interleaved order; using the same deployer for another transaction invalidates later predictions. Do not rewrite a peer address after deployment. Smart-wallet deployment requires a separate reviewed factory plan; a Safe does not execute this EOA CREATE sequence by importing ordinary calls.

After explicit financial deployment authorization, the deployer independently signs/broadcasts the reviewed transactions. Record transaction hashes by plan name (`baseUsdc`, `l1Usdc`, `baseInbox`, `basePrices`, `baseEth`, `l1Prices`, `l1Eth`, `baseKeeper`, `l1Keeper`). Capture activation evidence only once receipts are finalized:

```sh
node scripts/vault-deployment.mjs capture .contract-build/plan.json .contract-build/vaultDeployments.json .contract-build/receipts.json
```

Capture rejects changed compiler/configuration, failed/unfinalized/reorged receipts, wrong sender/nonce/creation input/value/address and drift in previously reviewed external identities. It never silently adopts a new upstream implementation. Supported pins cover direct code, EIP-1967 and legacy ZeppelinOS implementations and one feed aggregator link; beacon and nested proxy/feed targets are rejected. Arbitrary proxy systems and changing upstream governance/configuration are not comprehensively frozen by code pins.

Review the captured manifest and verification evidence, verify contract source on the explorers, then explicitly replace `src/vaultDeployments.json` in a new tested source commit and static release. Never activate from a URL, local storage, arbitrary RPC return or copied unverified address. Contract constructors instantiate isolated WaitingEscrow and ServicePosition children; their actual deployed code is captured as well.

## Progress, relaying and recovery

The portal supports user entry/exit/claim/cancellation/receipt transfer and bounded progress; ETH advanced tools cover its registered ServicePosition drain and local flash defense. These are explicit wallet reviews. Permissionless progress does not mean a static page is always running.

`KeeperBudget` holds **separate** optional sponsor Ether. It pays a fixed pull-claim tip for the first qualifying Base stage/draw progress or authenticated message, never from vault capital. It has no guaranteed service level: subsequent chunks may need unpaid execution, sponsors can withdraw unspent budgets, and ETH stages are not fully automated or tipped. Always simulate and price gas before offering execution. The contract tests record EVM execution gas, not L1 data fees or a claim of profitable real-world MEV operation.

The optional operator tool retrieves Circle attestations and exports fixed-target, simulated unsigned calls:

```sh
node scripts/cctp-relay.mjs fetch 0 SOURCE_TRANSACTION_HASH .contract-build/circle.json
node scripts/cctp-relay.mjs relay .contract-build/plan.json src/vaultDeployments.json 8453 CALLER .contract-build/message.json .contract-build/relay.json
node scripts/cctp-relay.mjs inbox .contract-build/plan.json src/vaultDeployments.json 8453 CALLER .contract-build/inbox-input.json .contract-build/inbox-call.json
```

Select one completed `{message, attestation}` from the Circle result for `message.json`. Source domain 0 is Ethereum and 6 is Base. The receiving route contract revalidates the message and attestation atomically during simulation/execution. Inbox input is `{operation, id}`; supported operations are invest, cancelWaiting, retrieveWaiting, claimDepositLot, startRedeem, claimExitLot, recoverLockedRedeem, closeRedeem, returnCash, closeOperation and announceStop (no ID). IDs refer to the operation, service request or lot indicated by that method. The return ceiling is constructed as the uint256 maximum; the contract still chooses the deterministic meaningful chunk. Operators cannot choose a recipient or arbitrary method/calldata. Re-simulate before signing because previews can become stale.

For a normal cross-chain entry: burn on Ethereum → relay authentic deposit on Base → invest → admit/reconcile native deposits → claim inbox lots → relay activation → collect L1 receipts. Exit: burn L1 receipts → relay redemption → start/reconcile Base redemption → collect exit lots → close requests → return actual USDC → relay each mint → relay closure → finalize and collect. Control/mint delivery can be reordered; count-and-total frontiers prevent premature finality. STOP propagates Base emergency facts to Ethereum, preserving independently safe refunds/claims. Circle service availability and destination gas remain required.

## Primary-source provenance

Dependencies were resolved from [Aave's address book](https://github.com/aave-dao/aave-address-book/tree/main/src/ts), then checked against numbered chain observations retained in this package. WETH/USD feeds come from each Aave oracle; USDC/USD uses the underlying `ASSET_TO_USD_AGGREGATOR()` because the CAPO adapter lacks `latestRoundData()`. These are deliberately distinct interfaces.

The Base sequencer feed is documented by [Chainlink](https://docs.chain.link/data-feeds/l2-sequencer-feeds). The fixed SwapRouter02 deployments and WETH addresses match [Uniswap Base](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments) and [Ethereum](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments). The minimal fixed swap interface avoids the broader Universal Router command surface. CCTP V2 uses [Circle's documented contract deployments](https://developers.circle.com/cctp/references/contract-addresses) and [message API](https://developers.circle.com/cctp/references/get-messages-v2).

`tests/integration/base-fork.mjs` is an optional actual-dependency execution harness using historical `eth_getProof`. Run it with suitable RPC access and retain its evidence before capital. Read-only dependency checks are not a passing fork test.

```sh
CLUB_BASE_RPC=YOUR_HTTPS_RPC node tests/integration/base-fork.mjs
```

All simulated deployments, fixture impersonation and funds exist only in the local VM. The harness never sends a transaction. It covers actual Aave waiting/borrow/repay/unwind when run successfully, not real Circle attestation or complete draw settlement. Do not mark it passed from read-only dependency checks.
