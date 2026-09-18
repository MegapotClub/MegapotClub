# Maintaining Megapot Club

Static React/TypeScript application. Build-time rendering produces HTML; no application server runs in production. Read `CONTRACTS` and the contract-specific invariants before changing their code.

- `src/App.tsx` and `src/navigation.ts`: fragment routes, desktop/mobile shell and restored views.
- `src/chain.ts`, `src/playerReads.ts`, query modules: validated, cached public observations.
- `src/native.ts`, `src/vaults.ts`, `src/transactions.ts`: canonical action planning, fresh simulation, explicit wallet submission and receipt recovery.
- `contracts/`: undeployed shared-vault implementations. Keep activation disabled until verified deployment evidence is configured.
- `src/*Copy.ts`, `src/locales/`, `src/retail-locales/`: eight languages. Update affected translations together.
- `scripts/finalize.mjs`: static entrypoints, metadata, notices and release manifest. Publish only `dist/`.

Unknown balances must never become zero. Failed refreshes retain only the same account's last valid observation. Read data, automatic refresh and restored URLs must never authorize wallet actions. Claims refresh their payout without a quote-change gate; account, chain, ownership, canonical calldata, contract identity and simulation checks remain mandatory. LP and vault actions retain economic review checks. Ambiguous transaction responses must never cause automatic resubmission.

Keep native links, Back/Forward, refresh, desktop/mobile parity, accessibility, reduced motion and all themes working. Use relative local assets for IPFS path-prefix portability. Preserve `@cc` invariants, exact integer amounts, six-decimal USDC and protocol timestamps. Retail draw displays use the shared five-minute settlement allowance; it never extends the purchase cutoff.

Use pinned Node/npm and `npm ci`. Run `npm run check`, `npm run build`, `npm run verify:release`; run `npm run contracts:build` for contract changes. Browser fixtures in `tests/browser/` use synthetic accounts and reject broadcasting. Inspect meaningful UI changes at desktop and narrow mobile widths. `npm run release:prepare` verifies fresh installs, tests, contract compilation and two identical builds from a clean commit. Do not activate deployments or broadcast from a test.

Keep credentials, operator notes, personal data, screenshots of real accounts, source maps and local machine paths outside public source and output. Document external services and meaningful remaining limitations without internal development history. See `docs/development.md`, `docs/architecture.md` and `docs/release.md`.
