# Architecture and invariants

Megapot Club is a static React application using wagmi, RainbowKit, viem and TanStack Query. Build-time rendering produces nine HTML entrypoints for eight languages. Relative assets and fragment routes work under IPFS path prefixes. Preferences and transaction journals stay in the browser; external RPC and indexed services provide public observations.

Queries isolate account, draw and endpoint configuration. Unknown amounts never become zero. A failed refresh may retain the same account's last valid observation. ENS identities share the wallet/query cache. Home and Results share the five largest wallet/draw win totals in a fourteen-day window. Indexed data enriches display and never authorizes signing.

`native.ts` owns literal typed ABIs and canonical actions. Retail reviews read sale flags, wallet funds, allowance and relevant ticket state at a consistent fresh block; they do not fetch unrelated LP/helper positions. Suitable calls use multicall. Simulation preserves the actual sender. Positive immutable runtime checks are cached by endpoint/address/hash for ten minutes. Every signature request still gets fresh state, simulation and provider/account/chain verification.

`purchaseDraft.ts` preserves selections and a unique journey/revision. Explicit valid invitations take precedence over `CLUB_REFERRER` in `referral.ts`; invalid invitations require an explicit clear. The immutable order retains that single beneficiary with weight 1e18, recipient, numbers and quantity. The source tag is separate from attribution. When allowance is insufficient, approval is for the exact total and purchase requires a second click. A stage change updates the UI without silently changing the wallet action.

Normal draw rollover is accepted. Fresh pricing informs display/approval, but the app adds no execution-time draw or price lock. The deployed sale flags, positive pool, funds and number bounds still apply. Receipt events establish the actual purchased draw, unique tickets, attribution and amount paid. An old receipt cannot complete another account's order or reset an edited/new draft.

`transactions.ts` keeps compact versioned records for every supported order, including 100 tickets. A submission mutex prevents competing tabs from requesting the same unresolved action. All journal writes use a separate shared mutex, prune resolved history before unresolved records, and preserve terminal outcomes, known hashes and wallet-selected nonces. Storage durability and wallet identity are checked before requesting a transaction. Restoration never repeats a wallet mutation. Hash-backed receipts reconcile automatically; lost-response purchase searches find bounded candidates for explicit verification. A missing hash, empty search or advanced nonce does not prove cancellation.

Claims refresh payout estimates without a quote-change gate. Ownership, chain, canonical calldata, contract identity and simulation remain mandatory. LP/vault actions retain their separate economic review rules. Direct contract-wallet wrapper execution is unsupported; EIP-7702 delegated EOAs retain the direct-transaction path.

Free ticket prize tiers are classified by matches (tiers 1 and 4), not by comparing a payout to exactly one dollar. They are ordinary USDC winnings claimable through Club. The official website's promotional guarantee excludes direct third-party purchases. No unsupported promotional entitlement is promised.

Win sharing creates a local branded PNG, offers its download and opens X's composer with verified award data and the account's referral link. The user attaches the image and posts. Invite separately retains clipboard and browser sharing. No X credential or application backend is needed.

`contracts/` contains undeployed shared-vault implementations. `vaultDeployments.json` keeps activation disabled pending verified deployment evidence and independent acceptance. Native LP uses existing Megapot contracts. The Support link appears only when its public destination is configured. Provider capacity, live wallet pairing/signing, gateway behavior and live social crawlers require deployment-specific acceptance.
