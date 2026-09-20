# Development

Use Node **24.19.0** and npm **11.9.0**, pinned in `.node-version`, `.npm-version` and `package.json`. The committed lockfile is required. A normal build needs no credentials and makes no chain calls. No external workspace artifacts are required.

```sh
npm ci
npm run check
npm run contracts:build
npm run build
npm run verify:release
npm run dev
```

Open `http://localhost:4173`. `check` typechecks the application and runs the Node test suite, including local EVM tests. `contracts:build` compiles Solidity with pinned solc, optimizer/via-IR settings and size gates. `build` prerenders nine HTML entrypoints; `.build/` contains intermediate SSR and bundle inventory, while `dist/` is the standalone site.

Every build clears the previous generated `dist/` and `.build/` directories. After building, `/dist/` on the development server serves the exported bytes and CSP without development HTML transforms. Check direct locale URLs, fragment navigation, refresh and asset loading there.

`tests/browser/retail.html` provides a synthetic wallet and read fixture. It never broadcasts or signs. `?walletOutcome=confirmed`, `reverted`, `ambiguous`, `unavailable`, `silent` or `rejected` controls its in-memory approval, purchase and claim outcomes; rejection is the default. Every send exercises the installed Coinbase WalletLink transaction encoder with only its relay replaced. `silent` withholds its response until the fixture control completes it. The Buffer import is module-local in both dependency optimization and production; the regression suite also verifies the encoder fails without it in a browser-like realm. Synthetic receipts survive reload within the browser session. Visible controls reset only synthetic activity, switch synthetic accounts and delay or fail balance reads. On insecure HTTP origins the fixture supplies an in-memory lock adapter; `?nativeLocks` disables that adapter to check fail-closed behavior. The application always requires native Web Locks for real submission. `tests/browser/layout.html` compares 320, 390, 448 and 1280 pixel layouts, using live data, the fixture or the export. These fixtures are not included in `dist/`.

The optional `npm run contracts:fork` requires a historical-proof-capable `CLUB_BASE_RPC`; a local mock test is not a substitute for a real-provider fork or funded acceptance.

`.env.example` inventories optional tooling values. Export operator values in your shell; operator scripts do not load dotenv files. Vite loads optional `DEV_ALLOWED_HOST` from its normal environment files. Do not commit credentials or embed privileged keys in browser code. `DEV_ALLOWED_HOST` optionally permits one additional local preview host.

`npm run snapshot` and `npm run snapshot:winners` explicitly update dated public data and require network access. Review their diffs before committing. Routine builds use checked-in data; browser reads refresh independently.

See [external services](services.md), [architecture](architecture.md) and [release procedure](release.md).

After a production build, `/tests/browser/manifest-auth/` verifies the generated manifest link against synthetic cookie authentication. Its control link reproduces the missing-credentials failure. This development-only fixture never accesses real session credentials.
