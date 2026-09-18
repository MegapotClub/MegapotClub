import { writeFile } from "node:fs/promises";
import { fetchSnapshot } from "../src/chain.ts";
import { DEFAULT_RPC_URLS } from "../src/config.ts";
const snapshot = await fetchSnapshot(DEFAULT_RPC_URLS);
await writeFile(
  new URL("../src/snapshot.json", import.meta.url),
  JSON.stringify(snapshot, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      block: snapshot.blockNumber,
      observedAt: new Date(snapshot.observedAt).toISOString(),
      currentDraw: snapshot.current.id,
      prizePool: snapshot.current.prizePool,
      recent: snapshot.recent.map((d) => ({ id: d.id, result: d.result })),
    },
    null,
    2,
  ),
);
