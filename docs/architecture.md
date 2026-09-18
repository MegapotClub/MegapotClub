# Architecture and invariants

Megapot Club is a static React application using wagmi, RainbowKit, viem and TanStack Query. Eight build-time rendered locale pages use relative assets and fragment routing. Browser preferences and operation journals are local; an explicit public-address lookup uses the URL fragment. No backend or application-owned wallet exists.

Reads use validated RPC observations and optional indexed enrichment. Query keys isolate account, draw and endpoint configuration. Unknown amounts are not zero; stale same-account results remain visible with a delayed-update state. ENS identities share a cache. The Home banner and Results recent wins use the same five-largest-wallet/draw totals over a fourteen-day window. Indexed values never authorize a wallet request.

`native.ts` restricts methods/destinations, checks linked contracts and code identity, verifies owned tickets and calculates net prizes at a consistent block. `transactions.ts` obtains a fresh review before every explicit send, estimates gas and revalidates the actual provider/account/chain immediately before handoff. Claims accept fresh payout and draw state for the same exact owned-ticket call without expiring a swap-style quote. Changed calldata/destination/value, stale or failed preflight, revoked wallet identity, cancellation and unresolved prior transactions still prevent submission. LP/vault economic checks remain in place.

Receipt journals distinguish rejection from ambiguous outcomes. Restoring a journal checks receipts only; it never replays a send. A missing wallet response cannot prove whether a transaction was submitted. Contract-wallet direct execution is not supported. Safe transaction-file export is not part of the app.

`contracts/` contains four shared-vault implementations and bounded recovery/progress tooling. `src/vaultDeployments.json` keeps them inactive until independently verified deployment evidence is installed. These contracts are not described as externally audited. Native LP uses existing Megapot protocol contracts.

Current boundaries: ticket purchase execution and promotional-credit redemption are not integrated; number selections are local drafts. Support configuration and the About source link are placeholders. Wallet pairing, production provider capacity, cross-chain operation and funded execution require deployment-specific acceptance. See the operator's release process before activating any custody deployment.
