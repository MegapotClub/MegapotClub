# External services and configuration

All browser configuration is public. The static application has no server-held secrets, database, analytics service or required API key. External providers still receive requests and may enforce per-IP limits.

| Service | Use | Configuration / credentials |
| --- | --- | --- |
| Base RPC | Public observations, wallet preflight, receipts | `src/config.ts`, `public/config.json`; editable browser settings. Public HTTPS endpoints by default. Never embed a privileged credential. |
| Ethereum RPC | ENS and optional Ethereum vault reads | `src/walletConfig.ts`, vault settings. Public RPC defaults. |
| Megapot Data API | Recent wins, result totals, paginated claimed history | `src/megapotApi.ts`; anonymous HTTPS reads, no secret. Display enrichment only. |
| Coinbase WalletLink | Optional Coinbase EOA phone pairing | Library connector; HTTPS/WSS relay. No project key configured. Requires HTTPS in production. |
| Wallet provider | Explicit account authorization and transaction requests | Injected/EIP-6963 provider. Keys remain in the wallet. |
| ENS avatar hosts / IPFS gateway | Public identity images | Provider/ENS data; untrusted presentation. Never transaction authority. |
| eth.limo and IPFS | Serve the static release under the ENS content record | Final origin `https://megapotclub.eth.limo`; pinning/gateway setup is an operator responsibility. |
| Circle, Aave, Chainlink and Uniswap | Optional undeployed shared-vault tooling/dependencies | `deployment/config.proposed.json`; reviewed dependency identities. Circle attestations are public. No signing key is accepted by tooling. |

Browser RPC operations have deadlines, bounded concurrency and no automatic transaction retry. The indexed API shares a serial request lane, eight starts per minute, an eight-second deadline, a 1 MiB response cap and cooldown on 429/503. Recent wins refresh every fifteen minutes; aggregate results hourly. Claim reviews refresh once per minute while open/visible, with a fresh read and simulation on Continue. Limits are per application instance, not a guarantee against shared-IP or multi-tab rate limits.

Optional operator `CLUB_BASE_RPC` / `CLUB_ETHEREUM_RPC` environment values can contain provider credentials. Keep them outside source and output; tooling does not persist their URLs. `.env.example` is a template, not active configuration. See [development](development.md).

The lockfile pins `tmp` 0.2.7 and older `ws` 8.x dependencies to 8.21.0 to address [tmp path handling](https://github.com/advisories/GHSA-7c78-jf6q-g5cm) and [ws memory exhaustion](https://github.com/advisories/GHSA-96hv-2xvq-fx4p). These narrow overrides preserve the existing wallet/compiler integration. Re-run dependency auditing and inspect actual browser module reachability when upgrading; a clean build is not a clean dependency audit.
