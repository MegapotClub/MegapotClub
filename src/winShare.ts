import encodeQR from "qr";
import { getAddress, isAddress } from "viem";
import { ORIGIN } from "./config.ts";
import { money } from "./model.ts";
import type { Locale } from "./i18n.ts";

export type ShareWin = { amount: string; account: string; date?: number };
export function invitationUrl(account: string) {
  if (!isAddress(account, { strict: false })) throw new Error("invalidAddress");
  return `${ORIGIN}/#play?ref=${getAddress(account.toLowerCase())}`;
}
export function winAmount(win: ShareWin, locale: Locale) {
  if (!/^[1-9]\d{0,77}$/.test(win.amount) || BigInt(win.amount) >= 2n ** 256n)
    throw new Error("invalidAmount");
  return `$${money(win.amount, locale, BigInt(win.amount) < 10_000n ? 6 : 2)}`;
}
export function xWinUrl(win: ShareWin, text: string) {
  winAmount(win, "en");
  return `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url: invitationUrl(win.account) })}`;
}
const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function shareJackpot(
  raw: string | null,
  locale: Locale,
): string | null {
  if (!raw || !/^[1-9]\d{0,77}$/.test(raw) || BigInt(raw) >= 2n ** 256n)
    return null;
  const unit = BigInt(raw) >= 1_000_000_000n ? 1_000_000_000n : 1_000_000n;
  const lower = (BigInt(raw) / unit) * unit;
  return lower > 0n ? `$${money(lower.toString(), locale, 0)}+` : null;
}
export function winQr(win: ShareWin) {
  return encodeQR(invitationUrl(win.account), "raw", {
    ecc: "quartile",
    border: 4,
  });
}
export function winCardSvg(
  win: ShareWin,
  locale: Locale,
  headline: string,
  wordmark = "",
) {
  const amount = winAmount(win, locale);
  const date =
    win.date && Number.isFinite(win.date)
      ? new Intl.DateTimeFormat(locale, {
          month: "short",
          day: "numeric",
        }).format(win.date * 1000)
      : "";
  const size = Math.min(128, 675 / (amount.length * 0.62));
  // Integer-sized modules and a four-module quiet zone survive image compression.
  const matrix = winQr(win),
    module = Math.floor(312 / matrix.length),
    side = module * matrix.length;
  const qr = matrix
    .flatMap((row, y) =>
      row.flatMap((dark, x) =>
        dark
          ? [
              `<rect x="${x * module}" y="${y * module}" width="${module}" height="${module}"/>`,
            ]
          : [],
      ),
    )
    .join("");
  const logo = wordmark.replace(
    /<svg[^>]*>/,
    '<svg x="42" y="20" width="460" height="131" viewBox="0 0 450 128">',
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#244BE9"/>
    <circle cx="1150" cy="-130" r="270" fill="none" stroke="#4163ef" stroke-width="52"/>
    ${logo}
    <g font-family="Arial,sans-serif" font-weight="800">
      <text x="58" y="235" font-size="${Math.min(48, 665 / (headline.length * 0.62))}" fill="#fff">${xml(headline)}</text>
      <text x="52" y="370" font-size="${size}" fill="#FF9365">${xml(amount)}</text>
      <text x="58" y="432" font-size="26" fill="#fff">${xml(date)}</text>
      <text x="58" y="562" font-size="34" fill="#fff">MegapotClub.eth.limo</text>
      <text x="975" y="552" text-anchor="middle" font-size="20" fill="#fff">THE INTERNET LOTTERY</text>
    </g>
    <rect x="798" y="171" width="354" height="354" rx="24" fill="#fff"/>
    <g transform="translate(${798 + (354 - side) / 2} ${171 + (354 - side) / 2})" fill="#19212C" shape-rendering="crispEdges">${qr}</g>
  </svg>`;
}
