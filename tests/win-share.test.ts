import test from "node:test";
import assert from "node:assert/strict";
import {
  invitationUrl,
  winAmount,
  winCardSvg,
  xWinUrl,
} from "../src/winShare.ts";
import { isFreeTicketTier } from "../src/prizeDisplay.ts";
import { groupClaimedWins } from "../src/claimedWins.ts";
import type { IndexedWin } from "../src/megapotApi.ts";
const account = "0x1111111111111111111111111111111111111111";
test("win sharing uses the verified amount and a canonical inviter link", () => {
  const win = { amount: "3883000000", account };
  assert.equal(winAmount(win, "en"), "$3,883.00");
  assert.equal(winAmount({ amount: "1", account }, "en"), "$0.000001");
  const url = new URL(xWinUrl(win, "I won $3,883 on Megapot Club!"));
  assert.equal(url.origin + url.pathname, "https://twitter.com/intent/tweet");
  assert.equal(url.searchParams.get("url"), invitationUrl(account));
  assert.equal(url.searchParams.get("text"), "I won $3,883 on Megapot Club!");
  for (const amount of ["0", "-1", "1.5", "01", (2n ** 256n).toString()])
    assert.throws(() => xWinUrl({ amount, account }, "win"));
  assert.throws(() => invitationUrl("javascript:alert(1)"));
});
test("share image preserves exact values and escapes external text", () => {
  const svg = winCardSvg(
    { amount: "213017160976", account },
    "en",
    '<script>&"win"',
  );
  assert.match(svg, /width="1200" height="630"/);
  assert.match(svg, /\$213,017.16/);
  assert.ok(!svg.includes("<script>"));
  assert.match(svg, /&lt;script&gt;&amp;&quot;win&quot;/);
});
test("free-ticket grouping follows prize tiers, not a one-dollar amount heuristic", () => {
  assert.equal(isFreeTicketTier(1n), true);
  assert.equal(isFreeTicketTier(4n), true);
  assert.equal(isFreeTicketTier(6n), false);
  const wins = [
    {
      user_ticket_id: "1",
      matched_normals: 0,
      bonusball_match: true,
      amount: { amount: "1000001" },
    },
    {
      user_ticket_id: "2",
      matched_normals: 2,
      bonusball_match: false,
      amount: { amount: "1000001" },
    },
    {
      user_ticket_id: "3",
      matched_normals: 3,
      bonusball_match: false,
      amount: { amount: "1000000" },
    },
  ].map((w) => ({ ...w, round_id: "173" })) as IndexedWin[];
  const [group] = groupClaimedWins([...wins, wins[0]]);
  assert.equal(group.freeTickets, 2);
  assert.equal(group.total, 3000002n);
  assert.equal(group.wins.length, 3);
});
