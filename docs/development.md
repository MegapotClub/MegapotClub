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

`tests/browser/retail.html` provides a synthetic wallet and read fixture. It never broadcasts or signs. `tests/browser/layout.html` compares narrow layouts. These fixtures are not included in `dist/`. The optional `npm run contracts:fork` requires a historical-proof-capable `CLUB_BASE_RPC`; a local mock test is not a substitute for a real-provider fork or funded acceptance.

`.env.example` inventories optional tooling values. Export operator values in your shell; operator scripts do not load dotenv files. Vite loads optional `DEV_ALLOWED_HOST` from its normal environment files. Do not commit credentials or embed privileged keys in browser code. `DEV_ALLOWED_HOST` optionally permits one additional local preview host.

`npm run snapshot` and `npm run snapshot:winners` explicitly update dated public data and require network access. Review their diffs before committing. Routine builds use checked-in data; browser reads refresh independently.

See [external services](services.md), [architecture](architecture.md) and [release procedure](release.md).
