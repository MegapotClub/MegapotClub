import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Gift, LoaderCircle } from "lucide-react";
import { ClaimedEarnings } from "./ClaimedEarnings.tsx";
import { usePlayerAccount } from "./playerQuery.ts";
import { useWallet } from "./wallet.ts";
import { WalletButton } from "./WalletButton.tsx";
import type { Locale } from "./i18n.ts";
import type { Route } from "./navigation.ts";
import { playCopy } from "./playCopy.ts";
import { money } from "./model.ts";
import { reviewAction, type Review, type Action } from "./native.ts";
import { errorCopy } from "./clubCopy.ts";
import { ReviewCard } from "./NativeWorkspace.tsx";
import { TransactionActivity } from "./WalletPanel.tsx";
import { NumberBalls, RouteLink } from "./RetailPrimitives.tsx";
import { Modal } from "./Modal.tsx";
import { DrawTime } from "./drawTime.tsx";
import type { PlayerObservation } from "./playerReads.ts";
type Prize = PlayerObservation["settledTickets"][number];
function WinReveal({
  prizes,
  locale,
  account,
  onClose,
}: {
  prizes: Prize[];
  locale: Locale;
  account: string;
  onClose: () => void;
}) {
  const prize = prizes[0],
    total = prizes.reduce((sum, t) => sum + t.net, 0n);
  const p = playCopy(locale),
    [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(
      () => setRevealed(true),
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1800,
    );
    return () => clearTimeout(timer);
  }, []);
  const finish = () => {
    try {
      localStorage.setItem(
        `megapot-club:seen-win:${account.toLowerCase()}:${prize.draw.id}`,
        "1",
      );
    } catch {}
    onClose();
  };
  const major =
    total >
    prize.draw.state.ticketPrice * BigInt(prize.draw.tickets.length) * 2n;
  return (
    <Modal title={p("drawResult")} closeLabel={p("close")} onClose={finish}>
      <div
        className={`win-reveal ${revealed ? "revealed" : ""} ${major ? "major-win" : ""}`}
      >
        <div className="reveal-rays" aria-hidden="true" />
        <NumberBalls
          numbers={
            prize.draw.result ? [...prize.draw.result[0]] : [...prize.normals]
          }
          bonus={prize.draw.result?.[1] ?? prize.bonusball}
        />
        <h2>{revealed ? p("youWon") : p("reveal")}</h2>
        {revealed ? (
          <>
            <strong className="reveal-amount">
              ${money(total.toString(), locale, 2)}
            </strong>
            <p>USDC</p>
            <button className="button button-primary" onClick={finish}>
              {p("done")}
              <Check size={18} />
            </button>
          </>
        ) : (
          <button className="text-button" onClick={() => setRevealed(true)}>
            {p("skip")}
          </button>
        )}
      </div>
    </Modal>
  );
}
/** @cc [label:data] no-unobserved-zero-balance
 * Unknown or another account's balances MUST NOT render as zero. Disconnect hides amounts and units.
 * Failed refreshes retain the same account's last chain observation; incomplete prize totals never imply zero.
 */
export function PlayerBalance({
  locale,
  urls,
  route,
  navigate,
}: {
  locale: Locale;
  urls: string[];
  route: Route;
  navigate: (r: Route) => void;
}) {
  const p = playCopy(locale),
    wallet = useWallet(),
    query = usePlayerAccount(urls, wallet.account),
    data =
      wallet.account &&
      query.data?.account.toLowerCase() === wallet.account.toLowerCase()
        ? query.data
        : undefined;
  const [review, setReview] = useState<Review | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [reveal, setReveal] = useState<{ account: string; prizes: Prize[] } | null>(
      null,
    );
  const run = useRef(0),
    seenSession = useRef(new Set<string>());
  const prizes = data?.settledTickets.filter((t) => t.net > 0n) ?? [],
    stale =
      query.isError ||
      Boolean(data && Date.now() - data.blockTime * 1000 > 120_000);
  useEffect(() => {
    run.current++;
    setReview(null);
    setBusy(false);
    setError("");
    setSelected([]);
    setReveal(null);
    return () => {
      run.current++;
    };
  }, [wallet.account, wallet.revision, urls]);
  useEffect(() => {
    if (!wallet.account || !data || stale || !data.pricingComplete) return;
    const win = prizes.find((t) => {
      const key = `${wallet.account}:${t.draw.id}`;
      if (seenSession.current.has(key)) return false;
      try {
        return !localStorage.getItem(
          `megapot-club:seen-win:${wallet.account!.toLowerCase()}:${t.draw.id}`,
        );
      } catch {
        return true;
      }
    });
    if (win) {
      seenSession.current.add(`${wallet.account}:${win.draw.id}`);
      setReveal({
        account: wallet.account,
        prizes: prizes.filter((t) => t.draw.id === win.draw.id),
      });
    }
  }, [data, wallet.account, stale]);
  useEffect(() => {
    setSelected((previous) =>
      previous.filter((id) => prizes.some((p) => p.ticketId.toString() === id)),
    );
  }, [data]);
  const prepareAction = async (action: Action) => {
    if (!wallet.account || busy) return;
    const seq = ++run.current;
    setBusy(true);
    setError("");
    setReview(null);
    try {
      const next = await reviewAction(urls, wallet.account, action);
      if (run.current === seq) setReview(next);
    } catch (e) {
      if (run.current === seq) setError(errorCopy(locale, e));
    } finally {
      if (run.current === seq) setBusy(false);
    }
  };
  const prepare = (ids: string[]) =>
    ids.length
      ? prepareAction({ kind: "claim", ids: ids.map(BigInt) })
      : Promise.resolve();
  return (
    <section className="retail-page player-balance">
      <h1>{p("balance")}</h1>
      <section className="retail-balance-card">
        {!wallet.account ? (
          <WalletButton locale={locale} />
        ) : (
          <>
            <strong
              className="retail-balance-amount"
              aria-busy={!data && query.isPending}
            >
              {data
                ? `$${money(
                    data.usdcBalance.toString(),
                    locale,
                    data.usdcBalance > 0n && data.usdcBalance < 10_000n ? 6 : 2,
                  )}`
                : "—"}
            </strong>
            <span className="retail-balance-unit">
              <img
                src={new URL("./assets/usdc.svg", import.meta.url).href}
                width="20"
                height="20"
                alt=""
              />
              {p("onBase")}
            </span>
          </>
        )}
        {wallet.account && data && stale && (
          <p className="inline-notice" role="status">
            {p("updatesDelayed")}
          </p>
        )}
      </section>
      {query.isPending && wallet.account && (
        <p role="status">{p("checkingPrizes")}</p>
      )}
      {wallet.account && query.isError && (
        <div className="inline-notice" role="alert">
          <p>{p("prizeReadError")}</p>
        </div>
      )}
      {wallet.account &&
        (prizes.length > 0 ||
          !data ||
          !data.pricingComplete ||
          query.isError) && (
          <section className="retail-unclaimed" aria-busy={busy}>
            <div className="section-top">
              <h2>
                {p("unclaimed")}{" "}
                {prizes.length > 0 && !stale && <span className="prize-dot" />}
              </h2>
              <strong>
                {data &&
                !stale &&
                (data.pricingComplete || data.prizeTotal > 0n)
                  ? `$${money(data.prizeTotal.toString(), locale, 2)}`
                  : "—"}
              </strong>
            </div>
            {prizes.map((prize) => (
              <article
                className="unclaimed-row"
                key={prize.ticketId.toString()}
              >
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(prize.ticketId.toString())}
                    disabled={
                      !selected.includes(prize.ticketId.toString()) &&
                      selected.length >= 30
                    }
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked
                          ? [...s, prize.ticketId.toString()]
                          : s.filter((id) => id !== prize.ticketId.toString()),
                      )
                    }
                  />
                  <span>
                    <strong>
                      ${money(prize.net.toString(), locale, 2)} USDC
                    </strong>
                    <small>
                      <DrawTime
                        timestamp={Number(prize.draw.state.drawingTime)}
                        locale={locale}
                      />
                    </small>
                  </span>
                </label>
                <button
                  className="button button-primary"
                  disabled={busy || stale}
                  onClick={() => void prepare([prize.ticketId.toString()])}
                >
                  {busy ? p("preparingClaim") : p("claim")}
                </button>
              </article>
            ))}
            {selected.length > 0 && (
              <button
                className="button button-primary full-width"
                disabled={busy || stale}
                onClick={() => void prepare(selected)}
              >
                {busy ? p("preparingClaim") : p("claimSelected")} (
                {selected.length}/30)
              </button>
            )}
            {data && !data.pricingComplete && (
              <p className="inline-notice">
                {p("partialPrizes", { count: data.unpricedTickets })}
              </p>
            )}
            {data && (
              <p className="fine-print">
                {p("recentCoverage", { count: data.draws.length })}
              </p>
            )}
          </section>
        )}
      {route.ticket &&
        !prizes.some((prize) => prize.ticketId.toString() === route.ticket) && (
          <div className="selected-ticket-review">
            <button
              className="button button-outline"
              disabled={busy}
              onClick={() => void prepare([route.ticket!])}
            >
              {busy ? p("preparingClaim") : p("claimSelected")}
            </button>
          </div>
        )}
      {busy && (
        <p className="claim-loading" role="status" aria-live="polite">
          <LoaderCircle
            size={20}
            className="loading-spinner"
            aria-hidden="true"
          />
          {p("preparingClaim")}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {review && (
        <ReviewCard
          review={review}
          locale={locale}
          urls={urls}
          onClose={() => setReview(null)}
          onSent={() => {
            setReview(null);
            setSelected([]);
          }}
        />
      )}
      {data && data.referralEarnings > 0n && (
        <section className="retail-unclaimed">
          <div className="section-top">
            <h2>{p("referralEarned")}</h2>
            <strong>
              ${money(data.referralEarnings.toString(), locale, 2)}
            </strong>
          </div>
          <button
            className="button button-outline"
            disabled={busy || stale}
            onClick={() => void prepareAction({ kind: "referral" })}
          >
            {p("claim")}
          </button>
        </section>
      )}
      {wallet.account && (
        <section className="retail-earnings">
          <h2>{p("earnings")}</h2>
          {prizes.map((prize) => (
            <article className="earning-card" key={prize.ticketId.toString()}>
              <div className="section-top">
                <strong>
                  <Gift size={19} /> {p("winner")}
                </strong>
              </div>
              <strong className="earning-amount">
                ${money(prize.net.toString(), locale, 2)} USDC
              </strong>
              <NumberBalls
                numbers={[...prize.normals]}
                bonus={prize.bonusball}
                small
              />
              <div className="earning-actions">
                <RouteLink
                  to={{ view: "tickets", draw: prize.draw.id.toString() }}
                  navigate={navigate}
                >
                  {p("viewTickets")}
                  <ArrowRight size={16} />
                </RouteLink>
                <RouteLink to={{ view: "play" }} navigate={navigate}>
                  {p("playAgain")}
                  <ArrowRight size={16} />
                </RouteLink>
              </div>
            </article>
          ))}
          {wallet.account && (
            <ClaimedEarnings
              account={wallet.account}
              locale={locale}
              navigate={navigate}
            />
          )}
        </section>
      )}
      {wallet.account && (
        <TransactionActivity
          locale={locale}
          urls={urls}
          account={wallet.account}
        />
      )}
      {reveal && wallet.account && reveal.account === wallet.account && (
        <WinReveal
          key={`${wallet.account}:${reveal.prizes[0].draw.id}`}
          prizes={reveal.prizes}
          locale={locale}
          account={wallet.account}
          onClose={() => setReveal(null)}
        />
      )}
    </section>
  );
}
