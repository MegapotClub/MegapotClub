import decodeQR from "qr/decode.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  invitationUrl,
  winAmount,
  winCardSvg,
  xWinUrl,
  sharePrizePool,
  winQr,
} from "../src/winShare.ts";
import { isFreeTicketTier } from "../src/prizeDisplay.ts";
import { groupClaimedWins } from "../src/claimedWins.ts";
import type { IndexedWin } from "../src/megapotApi.ts";
const account = "0x1111111111111111111111111111111111111111";
const wordmark = readFileSync(
  new URL("../brand/svg/megapot-club-logo-on-dark.svg", import.meta.url),
  "utf8",
);
const clubIcon = readFileSync(
  new URL("../brand/svg/megapot-club-icon-color.svg", import.meta.url),
  "utf8",
);
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
    wordmark,
    clubIcon,
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

test("the branded QR carries the exact inviter path and pool captions use conservative amounts", () => {
  const matrix = winQr({ amount: "3020000", account }),
    scale = 5,
    width = matrix.length * scale;
  const data = new Uint8Array(width * width * 4);
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4,
        // Erase the full logo backing: decoding must tolerate its worst-case damage.
        mx = Math.floor(x / scale),
        my = Math.floor(y / scale),
        covered =
          Math.abs(mx + 0.5 - matrix.length / 2) < 5 &&
          Math.abs(my + 0.5 - matrix.length / 2) < 5,
        value = !covered && matrix[my][mx] ? 0 : 255;
      data.set([value, value, value, 255], offset);
    }
  assert.equal(
    decodeQR({ width, height: width, data }),
    invitationUrl(account),
  );
  assert.equal(sharePrizePool("220567999999", "en"), "$220,000+");
  assert.equal(sharePrizePool("1133024667046", "en"), "$1,133,000+");
  const copy = JSON.parse(
    readFileSync(
      new URL("../src/retail-locales/en.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    `${copy.winShareText.replace("{amount}", "$3.02")} ${copy.winSharePrizePool.replace("{prizePool}", "$1,133,000+")}`,
    "I won $3.02 on Megapot Club! Play the $1,133,000+ daily prize pool now:",
  );
  assert.equal(sharePrizePool("1", "en"), null);
  for (const raw of [null, "0", "-1", "1.1", (2n ** 256n).toString()])
    assert.equal(sharePrizePool(raw, "en"), null);
});
