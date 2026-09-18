import { useEffect, useState } from "react";
import { requestWalletReset } from "./walletConfig.ts";
import { useWalletReady } from "./WalletProviders.tsx";
import { ticketCopy } from "./ticketCopy.ts";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { clubCopy } from "./clubCopy.ts";
import type { Locale } from "./i18n.ts";

export function WalletButton({
  locale,
  header = false,
}: {
  locale: Locale;
  header?: boolean;
}) {
  const ready = useWalletReady();
  const [slow, setSlow] = useState(false);
  const [resetError, setResetError] = useState(false);
  useEffect(() => {
    if (ready) {
      setSlow(false);
      return;
    }
    const timeout = window.setTimeout(() => setSlow(true), 8_000);
    return () => window.clearTimeout(timeout);
  }, [ready]);
  const reset = () => {
    try {
      requestWalletReset();
      location.reload();
    } catch {
      setResetError(true);
    }
  };
  return (
    <div className={header ? "header-wallet" : "library-wallet"}>
      {!ready ? (
        <span className="wallet-restoring">
          <button
            className="button button-secondary"
            disabled={!slow}
            aria-busy={!slow}
            onClick={slow ? reset : undefined}
            title={slow ? ticketCopy(locale)("restoreSlow") : undefined}
          >
            {ticketCopy(locale)(slow ? "resetWallet" : "restoring")}
          </button>
          {resetError && (
            <small role="alert">{clubCopy(locale)("storageFailed")}</small>
          )}
        </span>
      ) : (
        <ConnectButton
          label={clubCopy(locale)(header ? "connectShort" : "connect")}
          accountStatus="full"
          chainStatus={header ? "none" : "full"}
          showBalance={false}
        />
      )}
    </div>
  );
}
