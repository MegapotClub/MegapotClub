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
export function winCardSvg(win: ShareWin, locale: Locale, headline: string) {
  const amount = winAmount(win, locale);
  const date =
    win.date && Number.isFinite(win.date)
      ? new Intl.DateTimeFormat(locale, {
          month: "short",
          day: "numeric",
        }).format(win.date * 1000)
      : "";
  const size = Math.min(142, 1080 / (amount.length * 0.62));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#244BE9"/>
    <g fill="#FF9365" transform="translate(86 88)"><rect x="-6" y="-28" width="12" height="56" rx="6"/><rect x="-6" y="-28" width="12" height="56" rx="6" transform="rotate(60)"/><rect x="-6" y="-28" width="12" height="56" rx="6" transform="rotate(120)"/></g>
    <g font-family="Outfit,Arial,sans-serif" font-weight="800"><text x="130" y="104" fill="#fff" font-size="42">Megapot</text><rect x="315" y="66" width="106" height="45" rx="10" fill="#FFE6D8"/><text x="330" y="97" font-size="26" fill="#AA410C">CLUB</text>
    <text x="600" y="250" text-anchor="middle" font-size="42" fill="#fff">${xml(headline)}</text>
    <text x="600" y="398" text-anchor="middle" font-size="${size}" fill="#FF9365">${xml(amount)}</text>
    <text x="76" y="554" font-size="27" fill="#fff">${xml(date)}</text>
    <text x="1124" y="554" text-anchor="end" font-size="27" fill="#fff">THE INTERNET LOTTERY</text></g>
  </svg>`;
}
