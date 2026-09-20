import { ReviewCard } from "./ReviewCard.tsx";
import { WalletConnection, TransactionActivity } from "./WalletPanel.tsx";
export { WalletConnection } from "./WalletPanel.tsx";
import { VaultWorkspace } from "./VaultWorkspace.tsx";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { formatEther } from "viem";
import type { Locale } from "./i18n.ts";
import { clubCopy, errorCopy } from "./clubCopy.ts";
import { money } from "./model.ts";
import { EXPLORER } from "./config.ts";
import { parseActionDraft } from "./actionDraft.ts";
import { NativeHistory } from "./NativeHistory.tsx";
import {
  REGISTRY,
  USDC,
  amountUSDC,
  readPosition,
  reviewAction,
  type Action,
  type Position,
  type Review,
} from "./native.ts";
import { useWallet } from "./wallet.ts";
import { downloadJSON, useTransactions } from "./transactions.ts";
import { normalNavigation, routeHref, type Route } from "./navigation.ts";

export function NativeWorkspace({
  locale,
  urls,
  mode = "lp",
  route,
  navigate,
}: {
  locale: Locale;
  urls: string[];
  mode?: "lp";
  route?: Route;
  navigate?: (route: Route) => void;
}) {
  const c = clubCopy(locale),
    w = useWallet(),
    [lastPosition, setPosition] = useState<Position | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [amount, setAmount] = useState(""),
    [percentage, setPercentage] = useState(100),
    [review, setReview] = useState<Review | null>(null),
    [reviewing, setReviewing] = useState(false),
    [watch, setWatch] = useState(route?.address ?? "");
  const [draftReady, setDraftReady] = useState(false),
    [draftStorageError, setDraftStorageError] = useState(false);
  useEffect(() => setWatch(route?.address ?? ""), [route?.address]);
  useEffect(() => {
    try {
      const draft = parseActionDraft(
        JSON.parse(
          localStorage.getItem("megapot-club:action-draft:v1") ?? "null",
        ),
      );
      if (draft) {
        setAmount(draft.amount);
        setPercentage(draft.percentage);
      }
    } catch {
      setDraftStorageError(true);
    }
    setDraftReady(true);
  }, []);
  useEffect(() => {
    if (!draftReady) return;
    try {
      localStorage.setItem(
        "megapot-club:action-draft:v1",
        JSON.stringify({ amount, percentage }),
      );
    } catch {
      setDraftStorageError(true);
    }
  }, [amount, percentage, draftReady]);
  const prepareRun = useRef(0);
  const run = useRef(0),
    entries = useTransactions();
  const account = route?.address ?? w.account;
  const position =
    lastPosition?.account.toLowerCase() === account?.toLowerCase()
      ? lastPosition
      : null;
  const tab = route?.tab ?? "position";
  useEffect(() => {
    setReview(null);
    setReviewing(false);
    prepareRun.current++;
  }, [tab]);
  const value = (n: bigint) => `${money(n.toString(), locale, 2)} USDC`;
  const refresh = async () => {
    const id = ++run.current;
    if (!account) {
      setPosition(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const p = await readPosition(urls, account);
      if (run.current === id) {
        setPosition(p);
      }
    } catch (e) {
      if (run.current === id) {
        setError(errorCopy(locale, e));
      }
    } finally {
      if (run.current === id) setLoading(false);
    }
  };
  useEffect(() => {
    setReview(null);
    setPosition(null);

    setReviewing(false);
    prepareRun.current++;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60_000);
    return () => {
      clearInterval(timer);
      run.current++;
      prepareRun.current++;
    };
  }, [account, urls, w.revision]);
  useEffect(() => {
    if (entries.some((x) => x.account === account && x.status === "confirmed"))
      void refresh();
  }, [entries.map((x) => `${x.id}:${x.status}`).join("|")]);
  async function prepare(action: Action) {
    if (!account || reviewing) return;
    setError("");
    setReview(null);
    setReviewing(true);
    const id = ++prepareRun.current;
    try {
      const next = await reviewAction(urls, account, action);
      if (prepareRun.current === id) setReview(next);
    } catch (e) {
      if (prepareRun.current === id) setError(errorCopy(locale, e));
    } finally {
      if (prepareRun.current === id) {
        setReviewing(false);
        setLoading(false);
      }
    }
  }
  const actionButton = (
    kind:
      | "finalize"
      | "referral"
      | "cancelSubscription"
      | "cancelBatch"
      | "emergencyExit"
      | "revoke",
    available: bigint | null,
  ) => (
    <button
      className="action-row"
      disabled={!available || reviewing}
      onClick={() => void prepare({ kind })}
    >
      <span>
        <strong>{c(kind)}</strong>
        <small>{available === null ? "—" : value(available)}</small>
      </span>
      <ChevronRight size={20} />
    </button>
  );
  const navigateTab =
    (next: Route) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (normalNavigation(e)) {
        e.preventDefault();
        navigate?.(next);
        setReview(null);
      }
    };
  return (
    <div className={`native-workspace ${mode === "lp" ? "lp-workspace" : ""}`}>
      {draftStorageError && (
        <p role="status" className="form-error">
          {c("storageFailed")}
        </p>
      )}
      {mode === "lp" && (
        <>
          <div className="page-heading">
            <div>
              <h1>{c("lpHeading")}</h1>
            </div>
            <span className="mini-label">
              {tab === "vaults" ? "Base · Ethereum" : "Base · USDC"}
            </span>
          </div>
          <p className="lp-risk-note">{c("lpIntro")}</p>
          <nav className="workspace-tabs" aria-label={c("lp")}>
            {(
              ["position", "activity", "details", "vaults", "recovery"] as const
            ).map((t) => {
              const next: Route = { ...route, view: "lp", tab: t };
              return (
                <a
                  key={t}
                  href={routeHref(next)}
                  aria-current={tab === t ? "page" : undefined}
                  onClick={navigateTab(next)}
                >
                  {c(t)}
                </a>
              );
            })}
          </nav>
        </>
      )}
      {(tab === "position" || tab === "recovery") && (
        <section className="action-card wallet-card">
          <div className="section-top">
            <h2>{c("account")}</h2>
          </div>
          <WalletConnection locale={locale} urls={urls} />
          {position && mode === "lp" && (
            <div className="wallet-balances">
              <div>
                <span>{c("walletBalance")}</span>
                <strong>{value(position.balance)}</strong>
              </div>
              <div>
                <span>{c("gas")}</span>
                <strong>
                  {Number(formatEther(position.ether)).toLocaleString(locale, {
                    maximumFractionDigits: 5,
                  })}{" "}
                  ETH
                </strong>
              </div>
            </div>
          )}
          {mode === "lp" && (
            <form
              className="watch-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (/^0x[0-9a-fA-F]{40}$/.test(watch))
                  navigate?.({ ...route, view: "lp", address: watch });
              }}
            >
              <label htmlFor="watch-address">
                {c("position")} · 0x
                <input
                  id="watch-address"
                  value={watch}
                  onChange={(e) => setWatch(e.target.value)}
                  placeholder="0x…"
                  maxLength={42}
                />
              </label>
              <button className="button button-outline" type="submit">
                {c("review")}
              </button>
            </form>
          )}
        </section>
      )}
      {loading && (
        <p role="status" className="fine-print">
          <RefreshCw size={16} className="spinning" />
          {c("working")}
        </p>
      )}
      {error && (
        <p className="inline-notice form-error" role="alert">
          {error}
        </p>
      )}
      {review && (
        <ReviewCard
          key={`${review.createdAt}:${review.account}`}
          review={review}
          locale={locale}
          urls={urls}
          onClose={() => setReview(null)}
          onSent={() => {
            setReview(null);
            void refresh();
          }}
        />
      )}
      {mode === "lp" && tab === "position" && position && (
        <>
          <div className="position-grid">
            {(
              [
                ["active", position.active],
                ["pendingDeposit", position.pending],
                ["exiting", position.exiting],
                ["claimable", position.claimable],
              ] as const
            ).map(([label, n]) => (
              <article
                className={`position-stat ${label === "claimable" && n > 0n ? "ready" : ""}`}
                key={label}
              >
                <span>{c(label)}</span>
                <strong>{money(n.toString(), locale, 2)}</strong>
                <small>USDC</small>
              </article>
            ))}
          </div>
          <p className="fine-print">{c("lpIntro")}</p>
          <div className="lp-actions-grid">
            <form
              className="action-card"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  void prepare({ kind: "deposit", amount: amountUSDC(amount) });
                } catch (error) {
                  setError(errorCopy(locale, error));
                }
              }}
            >
              <h2>{c("deposit")}</h2>
              <p>{c("depositHelp")}</p>
              <label htmlFor="deposit-amount">{c("amount")}</label>
              <div className="amount-field">
                <input
                  id="deposit-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  required
                />
                <span>USDC</span>
              </div>
              <p className="fine-print">
                {c("headroom")}
                <br />
                {value(
                  position.cap > position.nextPool
                    ? position.cap - position.nextPool
                    : 0n,
                )}
              </p>
              <button
                className="button button-primary"
                disabled={reviewing || position.locked || position.emergency}
              >
                {reviewing ? c("working") : c("review")}
                <ChevronRight size={18} />
              </button>
            </form>
            <section className="action-card">
              <h2>{c("withdraw")}</h2>
              <p>{c("exitHelp")}</p>
              <label htmlFor="exit-percent">
                {percentage}% · {c("shares")}
              </label>
              <input
                id="exit-percent"
                type="range"
                min={1}
                max={100}
                value={percentage}
                onChange={(e) => setPercentage(Number(e.target.value))}
              />
              <div className="percentage-options">
                {[25, 50, 75, 100].map((n) => (
                  <button
                    className={percentage === n ? "selected" : ""}
                    key={n}
                    onClick={() => setPercentage(n)}
                  >
                    {n}%
                  </button>
                ))}
              </div>
              <p className="fine-print">
                {((position.shares * BigInt(percentage)) / 100n).toString()} ·{" "}
                {c("shares")}
              </p>
              <button
                className="button button-outline"
                disabled={
                  reviewing ||
                  !position.shares ||
                  position.locked ||
                  position.emergency
                }
                onClick={() =>
                  void prepare({
                    kind: "withdraw",
                    shares: (position.shares * BigInt(percentage)) / 100n,
                  })
                }
              >
                {c("review")}
                <ChevronRight size={18} />
              </button>
            </section>
          </div>
          <section className="action-card">
            {actionButton(
              "finalize",
              position.emergency ? 0n : position.claimable,
            )}
            {position.emergency &&
              actionButton(
                "emergencyExit",
                position.active +
                  position.pending +
                  position.exiting +
                  position.claimable,
              )}
            <button
              className="text-button passport-button"
              onClick={() =>
                downloadJSON("megapot-club-position.json", {
                  schema: 1,
                  chainId: 8453,
                  scope: "native Megapot LP; no wrapper assets",
                  observedAt: new Date().toISOString(),
                  position,
                  registry: REGISTRY,
                })
              }
            >
              <ArrowDownToLine size={17} />
              {c("exportPosition")}
            </button>
          </section>
        </>
      )}
      {tab === "recovery" && position && (
        <section className="action-card">
          <h2>{c("recovery")}</h2>
          <p>{c("recoveryHelp")}</p>
          {actionButton("cancelSubscription", position.subscription)}
          {actionButton("cancelBatch", position.batch)}
          {actionButton("revoke", position.allowance)}
        </section>
      )}
      {tab === "activity" && (
        <TransactionActivity
          locale={locale}
          urls={urls}
          account={account ?? undefined}
        />
      )}
      {mode === "lp" && tab === "details" && (
        <NativeHistory locale={locale} urls={urls} />
      )}
      {mode === "lp" && tab === "details" && (
        <section className="action-card">
          <h2>{c("details")}</h2>
          <p>{c("lpIntro")}</p>
          {position && (
            <dl className="review-facts">
              <dt>{c("shares")}</dt>
              <dd>{position.shares.toString()}</dd>
              <dt>{c("allowance")}</dt>
              <dd>{value(position.allowance)}</dd>
            </dl>
          )}
          <div className="registry-list">
            {[...REGISTRY, { name: "USDC", address: USDC, hash: "" }].map(
              (r) => (
                <div key={r.address}>
                  <strong>{r.name}</strong>
                  <a
                    href={`${EXPLORER}/address/${r.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <code>{r.address}</code>
                    <ArrowUpRight size={16} />
                  </a>
                  {r.hash && <code className="runtime-hash">{r.hash}</code>}
                </div>
              ),
            )}
          </div>
        </section>
      )}
      {mode === "lp" && tab === "vaults" && (
        <VaultWorkspace
          key={route?.product ?? "base-usdc"}
          locale={locale}
          baseUrls={urls}
          route={route ?? { view: "lp", tab: "vaults" }}
          navigate={(next) => navigate?.(next)}
        />
      )}
    </div>
  );
}
