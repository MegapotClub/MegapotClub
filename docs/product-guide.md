# Megapot Club product guide

Megapot Club is an independent community app for the Megapot protocol. It runs in the browser and reads public chain data.

Navigation uses fragment routes: `#draw`, `#tickets`, `#winnings`, `#results`, `#invite`, `#about` and `#lp`. `#tickets?draw=175` selects a draw; `#results?draw=174` opens its result. `#winnings?ticket=174001` prepares a selected ticket for an explicit review; visiting a URL never submits a transaction. Optional `address` and `page` fields select public read-only ticket views. Back/Forward and refresh restore safe view state.

Wallet observations update automatically. Unknown balances are never zero. Refresh failures preserve the same account's last valid observation and display a delayed-update state. Recent history may have partial coverage; older ticket draws and cursor-paginated claimed history remain accessible. ENS names are preferred when available.

Retail dates use the local timezone. Expected draw settlement is five minutes after the protocol's scheduled cutoff, currently 17:05 UTC (12:05 EST). Schedule and countdown alternate every eight seconds. This display allowance never changes protocol timestamps or extends the purchase cutoff.

Claims and supported native LP actions require a separate review and wallet confirmation. Claim data refreshes before sending; account, chain, ownership, contract identity and simulation checks remain mandatory. The technical details are optional. Restored activity checks receipts without resubmitting.

Ticket selections are local drafts; purchase execution and promotional-credit redemption are not integrated. Shared Club vault contracts are not deployed or activated. Native LP uses existing protocol contracts. Direct contract-wallet execution is unsupported.

`snapshot.json` is a dated release asset, not a live API. It includes chain identity, block/hash/time, observedAt and draw data; raw USDC uses six-decimal integer units. `release.json` identifies the build and its asset hashes. Automatic browser reads may be newer than the included snapshot. Read and navigation agent tools cannot submit transactions.
