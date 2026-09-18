import fs from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { readResultHistory, readRoundPlayers } from "../src/megapotApi.ts";

const observedAt = Date.now();
const history = await readResultHistory();
const wanted = history.stats.rounds.filter(
  (row) =>
    row.time >= observedAt / 1000 - 14 * 86_400 &&
    row.time <= observedAt / 1000,
);
const rounds = [];
for (const row of wanted) {
  // Respect the anonymous API quota, including the initial history read.
  await pause(8_000);
  const wins = await readRoundPlayers(row.id);
  rounds.push({ id: row.id, time: row.time, wins: wins.data });
  console.log(`Captured settled draw ${row.id}: ${wins.data.length} wins`);
}
if (!rounds.length) throw new Error("No settled rounds in the recent window");
await fs.writeFile(
  new URL("../src/recentWinsSnapshot.json", import.meta.url),
  JSON.stringify({ observedAt, rounds }, null, 2) + "\n",
);
console.log(`Saved complete ${rounds.length}-draw winner snapshot`);
