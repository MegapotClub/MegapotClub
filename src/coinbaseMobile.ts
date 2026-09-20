type BrowserDevice = Pick<Navigator, "userAgent"> &
  Partial<Pick<Navigator, "platform" | "maxTouchPoints">>;

/**
 * @cc [label:product] coinbase-mobile-handoff
 * Coinbase's mobile handoff MUST stay available on touch mobile browsers,
 * including desktop-mode iPadOS. A desktop platform or non-touch device MUST
 * NOT open a mobile wallet link solely because its user agent was emulated.
 * This presentation hint MUST NOT authorize or alter a wallet transaction.
 */
export function isCoinbaseMobileBrowser(
  device: BrowserDevice | undefined = typeof window === "undefined"
    ? undefined
    : window.navigator,
): boolean {
  if (!device) return false;
  const { userAgent, platform = "", maxTouchPoints } = device;
  if (
    /Macintosh/i.test(userAgent) &&
    /Mac/i.test(platform) &&
    maxTouchPoints !== undefined &&
    maxTouchPoints > 1
  )
    return true;
  if (/Win|Mac|Linux (?:x86_64|i[3-6]86)/i.test(platform)) return false;
  if (maxTouchPoints === 0) return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    userAgent,
  );
}
