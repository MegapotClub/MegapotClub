# Static release

The canonical origin is `https://megapotclub.eth.limo`. Canonical, Open Graph, X card, robots and sitemap URLs are rendered into every HTML entrypoint; crawlers do not need JavaScript. `public/og.png` is the neutral Club social card. Fragment routes share this site card because fragments are not sent to a web server. No per-wallet or per-win card is generated.

From a clean, committed checkout with pinned Node/npm:

```sh
npm ci
npm run release:prepare
```

The command archives the exact HEAD into two fresh directories, installs from the lockfile twice, runs checks and contract compilation on the first checkout, builds under UTC and Pacific/Honolulu, verifies both manifests and compares every output byte. It writes `.release/<commit>/site/`, `site.tar.gz`, `provenance.json` and `SHA256SUMS`. The artifact's `release.json` and provenance name that commit. Source archives without Git can run `npm run build`; release preparation requires Git and supplies the revision explicitly.

Serve or pin only the accepted `site/` directory, preserving all files and directory entrypoints. Relative assets and hash routes work at a domain root or `/ipfs/<cid>/`; no SPA rewrite is required. Do not upload the repository, environment files, `.git`, tests or intermediate directories as the site. Keep the accepted source commit, lockfile, artifact and provenance together.

```sh
npm run verify:deployment -- --url https://your-gateway.example/ --artifact .release/COMMIT/site
```

This checks served bytes against the local artifact without invoking chain APIs. Also inspect desktop/mobile routes, refresh, locale subdirectories, wallet behavior and crawler-visible metadata on the final gateway. Asset verification does not prove chain availability or funded wallet execution.

For ENS/IPFS, pin the accepted directory, record the resulting CID alongside its commit and archive hash, and verify it through an IPFS gateway before changing the ENS content record. Configure `megapotclub.eth` to that content record. Actual eth.limo resolution and X's remote crawler cannot be verified before deployment; test both afterward. See [eth.limo documentation](https://eth-limo.gitbook.io/documentation).

For rollback, retain the previous pinned CID and artifact. Restore the prior ENS content record, then repeat served-byte and browser checks; gateway/crawler caches may delay the visible change. A static site rollback does not reverse any blockchain transaction or custody deployment.
