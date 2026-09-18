import { WalletConnection, TransactionActivity } from "./WalletPanel.tsx";
export { WalletConnection } from "./WalletPanel.tsx";
import { VaultWorkspace } from "./VaultWorkspace.tsx";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { formatEther } from "viem";
import type { Locale } from "./i18n.ts";
import { clubCopy, errorCopy } from "./clubCopy.ts";
import { experienceCopy } from "./experienceCopy.ts";
import { retailCopy } from "./retailCopy.ts";
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
  ticketIds,
  type Action,
  type Position,
  type Review,
} from "./native.ts";
import { useWallet } from "./wallet.ts";
import { downloadJSON, submitReview, useTransactions } from "./transactions.ts";
import { normalNavigation, routeHref, type Route } from "./navigation.ts";

export function ReviewCard({
  review: initialReview,
  locale,
  urls,
  onClose,
  onSent,
}: {
  review: Review;
  locale: Locale;
  urls: string[];
  onClose: () => void;
  onSent: () => void;
}) {
  const c = clubCopy(locale),
    wallet = useWallet(),
    revision = useRef(wallet.revision),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submission = useRef<AbortController | null>(null);
  useEffect(() => () => submission.current?.abort(), []);
  const claiming = initialReview.action.kind === "claim";
  const queryClient = useQueryClient();
  const queryKey = [
    "claim-review",
    initialReview.account.toLowerCase(),
    initialReview.createdAt,
    urls,
  ];
  const refreshed = useQuery({
    queryKey,
    queryFn: () =>
      reviewAction(urls, initialReview.account, initialReview.action),
    initialData: initialReview,
    initialDataUpdatedAt: initialReview.createdAt,
    enabled: claiming && !busy && wallet.revision === revision.current,
    staleTime: 30_000,
    gcTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const review = claiming ? refreshed.data : initialReview;
  const call = review.calls[0];
  const matches =
    wallet.account?.toLowerCase() === review.account.toLowerCase() &&
    wallet.chainId === 8453 &&
    !review.position.contractWallet &&
    wallet.revision === revision.current;
  return (
    <section
      className="review-card"
      aria-labelledby="review-title"
      tabIndex={-1}
      ref={(el) => {
        if (el && !el.dataset.focused) {
          el.dataset.focused = "true";
          el.focus();
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }}
    >
      <div className="section-top">
        <div className="eyebrow">
          <ShieldCheck size={18} />
          {c("review")}
        </div>
        <button className="text-button" onClick={onClose} disabled={busy}>
          {c("close")}
        </button>
      </div>
      <h2 id="review-title">{c(call.kind)}</h2>
      <p className="review-amount">
        {claiming ? "$" : ""}
        {money(
          review.amount.toString(),
          locale,
          claiming && review.amount >= 10_000n ? 2 : 6,
        )}{" "}
        <small>USDC</small>
      </p>
      {call.kind === "approve" && (
        <p className="inline-notice">{c("approvalHelp")}</p>
      )}
      {review.action.kind === "deposit" && <p>{c("depositHelp")}</p>}
      {review.action.kind === "withdraw" && <p>{c("exitHelp")}</p>}
      {claiming && refreshed.isError && (
        <p className="inline-notice" role="status">
          {c("claimRefreshDelayed")}
        </p>
      )}
      <details className="call-inspector">
        <summary>{c("rawTransaction")}</summary>
        <p className="fine-print">{c("receive")}</p>
        <dl className="review-facts">
          <dt>{c("destination")}</dt>
          <dd>
            <a
              href={`${EXPLORER}/address/${call.to}`}
              target="_blank"
              rel="noreferrer"
            >
              <code>{call.to}</code>
            </a>
          </dd>
          <dt>Base · 8453</dt>
          <dd>#{review.block.toString()}</dd>
          <dt>{c("connected")}</dt>
          <dd>
            <code>{review.account}</code>
          </dd>
        </dl>
        <p className="fine-print">{c("noFee")}</p>
        <p>{c("exactCall")}:</p>
        <code>{call.data}</code>
        <p>value: 0 ETH · {review.calls.length} transaction(s)</p>
      </details>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="review-buttons">
        <button
          className="button button-primary"
          disabled={!matches || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            const controller = new AbortController();
            submission.current = controller;
            try {
              await submitReview(
                urls,
                review,
                revision.current,
                controller.signal,
                (fresh) => queryClient.setQueryData(queryKey, fresh),
              );
              if (!controller.signal.aborted) onSent();
            } catch (e) {
              if (!controller.signal.aborted) setError(errorCopy(locale, e));
            } finally {
              if (!controller.signal.aborted) setBusy(false);
              if (submission.current === controller) submission.current = null;
            }
          }}
        >
          {busy ? c("working") : c("sign")}
          <ChevronRight size={18} />
        </button>
      </div>
      {!matches && (
        <p className="fine-print">
          {c(
            review.position.contractWallet ? "contractWallet" : "walletChanged",
          )}
        </p>
      )}
    </section>
  );
}

export function NativeWorkspace({
  locale,
  urls,
  mode = "account",
  route,
  navigate,
}: {
  locale: Locale;
  urls: string[];
  mode?: "account" | "lp";
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
    [ids, setIds] = useState(""),
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
        setIds(draft.ids);
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
        JSON.stringify({ amount, ids, percentage }),
      );
    } catch {
      setDraftStorageError(true);
    }
  }, [amount, ids, percentage, draftReady]);
  const prepareRun = useRef(0);
  const r = retailCopy(locale);
  const x = experienceCopy(locale);
  const claimIds = route?.ticket ?? ids;
  const [claimOpen, setClaimOpen] = useState(false);
  const [balanceStale, setBalanceStale] = useState(false);
  const [balanceNow, setBalanceNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setBalanceNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const run = useRef(0),
    entries = useTransactions();
  const account = mode === "lp" ? (route?.address ?? w.account) : w.account;
  const position =
    lastPosition?.account.toLowerCase() === account?.toLowerCase()
      ? lastPosition
      : null;
  const tab = route?.tab ?? "position";
  const section = route?.section ?? "prizes";
  useEffect(() => {
    setReview(null);
    setReviewing(false);
    prepareRun.current++;
  }, [tab, section, route?.ticket, ids]);
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
        setBalanceStale(false);
      }
    } catch (e) {
      if (run.current === id) {
        setBalanceStale(true);
        setError(errorCopy(locale, e));
      }
    } finally {
      if (run.current === id) setLoading(false);
    }
  };
  useEffect(() => {
    setReview(null);
    setPosition(null);
    setBalanceStale(false);
    setReviewing(false);
    prepareRun.current++;
    void refresh();
    return () => {
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
    <div
      className={`native-workspace ${mode === "lp" ? "lp-workspace" : ""}`}
      data-section={mode === "account" ? section : undefined}
    >
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
      {mode === "account" && (
        <nav
          className="workspace-tabs winnings-tabs"
          aria-label={r("winnings")}
        >
          {(["prizes", "refunds", "activity"] as const).map((s) => {
            const next: Route = { view: "winnings", section: s };
            return (
              <a
                key={s}
                href={routeHref(next)}
                aria-current={section === s ? "page" : undefined}
                onClick={navigateTab(next)}
              >
                {s === "prizes"
                  ? r("prizes")
                  : s === "refunds"
                    ? r("recovery")
                    : c("activity")}
              </a>
            );
          })}
        </nav>
      )}
      {((mode === "account" && section !== "activity") ||
        (mode === "lp" && (tab === "position" || tab === "recovery"))) && (
        <section className="action-card wallet-card">
          <div className="section-top">
            <h2>{mode === "lp" ? c("account") : x("inWallet")}</h2>
            {account && (
              <button
                className="icon-button"
                disabled={loading}
                aria-label={c("refresh")}
                onClick={() => void refresh()}
              >
                <RefreshCw size={18} className={loading ? "spinning" : ""} />
              </button>
            )}
          </div>
          {mode === "account" && (
            <div className="balance-spotlight">
              {account ? (
                <>
                  <strong>
                    {position
                      ? money(position.balance.toString(), locale, 6)
                          .replace(/([.,]\d*?)0+$/, "$1")
                          .replace(/[.,]$/, "")
                      : "—"}
                  </strong>
                  <span>
                    <span className="usdc-mark" aria-hidden="true">
                      $
                    </span>
                    {x("onBase")}
                  </span>
                  {position && (
                    <small>
                      {c("gas")}: {formatEther(position.ether)} ETH
                    </small>
                  )}
                  {position && (
                    <small className={balanceStale ? "balance-stale" : ""}>
                      {balanceStale
                        ? x("localStale")
                        : balanceNow / 1000 - Number(position.timestamp) > 120
                          ? x("lastKnown")
                          : `Base · #${position.block.toString()}`}{" "}
                      ·{" "}
                      {new Date(
                        Number(position.timestamp) * 1000,
                      ).toLocaleString(locale, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZoneName: "short",
                      })}
                    </small>
                  )}
                </>
              ) : (
                <>
                  <span className="balance-orb" aria-hidden="true">
                    <Wallet size={32} />
                  </span>
                  <h3>{x("balanceConnect")}</h3>
                </>
              )}
            </div>
          )}
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
      {mode === "account" && section === "prizes" && (
        <section className="action-card earnings-card">
          <h2>{x("earnings")}</h2>
          <p>{x("earningsHelp")}</p>
          <a
            className="text-button ticket-id-link"
            href="#tickets?period=past"
            onClick={navigateTab({ view: "tickets", period: "past" })}
          >
            {x("findPrizes")}
            <ArrowUpRight size={16} />
          </a>
          <details
            className="claim-disclosure"
            open={Boolean(route?.ticket) || claimOpen}
            onToggle={(event) => setClaimOpen(event.currentTarget.open)}
          >
            <summary>
              {route?.ticket ? x("lookupReady") : r("claimById")}
            </summary>
            <p>{x("verifiedReview")}</p>
            <label htmlFor="claim-ids">{c("ticketIds")}</label>
            <input
              id="claim-ids"
              value={claimIds}
              onChange={(e) => {
                setClaimOpen(true);
                setIds(e.target.value);
                setReview(null);
                prepareRun.current++;
                setReviewing(false);
                if (route?.ticket) navigate?.({ ...route, ticket: undefined });
              }}
              placeholder="123, 456"
              maxLength={2400}
            />
            <div className="wallet-buttons">
              <button
                className="button button-primary"
                disabled={!account || reviewing || !claimIds.trim()}
                onClick={() => {
                  try {
                    void prepare({ kind: "claim", ids: ticketIds(claimIds) });
                  } catch (e) {
                    setError(errorCopy(locale, e));
                  }
                }}
              >
                {c("review")}
              </button>
              {position?.emergency && (
                <button
                  className="button button-outline"
                  disabled={reviewing || !claimIds.trim()}
                  onClick={() => {
                    try {
                      void prepare({
                        kind: "refund",
                        ids: ticketIds(claimIds),
                      });
                    } catch (e) {
                      setError(errorCopy(locale, e));
                    }
                  }}
                >
                  {c("refund")}
                </button>
              )}
            </div>
          </details>
          {position && (
            <div className="referral-summary">
              <h3>{x("referralEarnings")}</h3>
              {position.referral > 0n ? (
                actionButton("referral", position.referral)
              ) : (
                <p>{x("noReferrals")}</p>
              )}
            </div>
          )}
        </section>
      )}
      {((mode === "account" && section === "refunds") ||
        (mode === "lp" && tab === "recovery")) &&
        position && (
          <section className="action-card">
            <h2>{c("recovery")}</h2>
            <p>{c("recoveryHelp")}</p>
            {actionButton("cancelSubscription", position.subscription)}
            {actionButton("cancelBatch", position.batch)}
            {actionButton("revoke", position.allowance)}
          </section>
        )}
      {((mode === "account" && section === "activity") ||
        (mode === "lp" && tab === "activity")) && (
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
              <dt>Base</dt>
              <dd>#{position.block.toString()}</dd>
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
