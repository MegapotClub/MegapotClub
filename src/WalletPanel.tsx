import { useQuery } from "@tanstack/react-query";
import { playCopy } from "./playCopy.ts";
import { DrawTime } from "./drawTime.tsx";
import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Locale } from "./i18n.ts";
import { clubCopy, errorCopy } from "./clubCopy.ts";
import { chainExplorer, type VaultChain } from "./evmClient.ts";
import { WalletButton } from "./WalletButton.tsx";
import {
  useTransactions,
  journalStorageAvailable,
  reconcile,
} from "./transactions.ts";

export function WalletConnection({
  locale,
}: {
  locale: Locale;
  urls: string[];
  chainId?: VaultChain;
}) {
  return (
    <div className="wallet-connect">
      <WalletButton locale={locale} />
    </div>
  );
}

export function TransactionActivity({
  locale,
  urls,
  account,
  chainId = 8453,
  focus = false,
}: {
  locale: Locale;
  urls: string[];
  account?: string;
  chainId?: VaultChain;
  focus?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [focus]);
  const items = useTransactions()
    .filter(
      (x) =>
        x.chainId === chainId &&
        (!account || x.account.toLowerCase() === account.toLowerCase()),
    )
    .reverse();
  const c = clubCopy(locale),
    [error, setError] = useState(""),
    [replacement, setReplacement] = useState<Record<string, string>>({});
  const pending = items.filter(
    (entry) =>
      entry.hash && ["pending", "wallet", "unknown"].includes(entry.status),
  );
  useQuery({
    queryKey: ["journal-receipts", chainId, urls, account?.toLowerCase()],
    enabled: chainId !== 8453 && pending.length > 0,
    queryFn: async () => {
      // Receipt reads only. Signing and resubmission remain explicit separate actions.
      for (const entry of pending.slice(0, 5))
        await reconcile(urls, entry).catch(() => {});
      return Date.now();
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return (
    <section className="action-card">
      <h2 ref={heading} tabIndex={-1}>
        {c("activity")}
      </h2>
      {!journalStorageAvailable() && (
        <p className="form-error">{c("storageFailed")}</p>
      )}
      {items.length === 0 && <p className="muted">{c("emptyActivity")}</p>}
      <div className="transaction-list">
        {items.map((entry) => (
          <article className="transaction-row" key={entry.id}>
            <div>
              <strong>{c(entry.kind)}</strong>
              <span className={`transaction-status ${entry.status}`}>
                {c(entry.status)}
              </span>
              <small>
                <DrawTime timestamp={entry.createdAt / 1000} locale={locale} />
              </small>
            </div>
            <div className="transaction-actions">
              {(entry.hash || entry.resolvedBy) && (
                <>
                  <a
                    className="icon-button"
                    aria-label={playCopy(locale)("viewTransaction")}
                    title={playCopy(locale)("viewTransaction")}
                    href={`${chainExplorer(chainId)}/tx/${entry.hash ?? entry.resolvedBy}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={17} />
                  </a>
                </>
              )}
              {["pending", "wallet", "unknown"].includes(entry.status) && (
                <details className="replacement-form">
                  <summary>{c("replacement")}</summary>
                  {entry.recovery?.candidates.map((hash) => (
                    <button
                      key={hash}
                      className="text-button"
                      onClick={() =>
                        void reconcile(urls, entry, hash).catch(() =>
                          setError(c("failed")),
                        )
                      }
                    >
                      {c("review")} · {hash.slice(0, 10)}…{hash.slice(-4)}
                    </button>
                  ))}
                  <label>
                    {c("transactionHash")}
                    <input
                      value={replacement[entry.id] ?? ""}
                      onChange={(e) =>
                        setReplacement({
                          ...replacement,
                          [entry.id]: e.target.value,
                        })
                      }
                      placeholder="0x…"
                      maxLength={66}
                    />
                  </label>
                  <button
                    className="text-button"
                    onClick={() =>
                      void reconcile(urls, entry, replacement[entry.id]).catch(
                        () => setError(c("failed")),
                      )
                    }
                  >
                    {playCopy(locale)("checkTransaction")}
                  </button>
                </details>
              )}
            </div>
          </article>
        ))}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}
