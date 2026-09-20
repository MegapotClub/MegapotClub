import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  LoaderCircle,
  ExternalLink,
  Minus,
  Plus,
  Shuffle,
  Sparkles,
  Pencil,
  Trash2,
} from "lucide-react";
import type { Locale } from "./i18n.ts";
import { money, type Draw } from "./model.ts";
import { quickPick, validNumbers } from "./plans.ts";
import { playCopy } from "./playCopy.ts";
import { clubCopy, errorCopy } from "./clubCopy.ts";
import { EXPLORER } from "./config.ts";
import { Modal } from "./Modal.tsx";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { switchBase, useWallet } from "./wallet.ts";
import { reviewAction, type Review } from "./native.ts";
import {
  submitReview,
  useTransactions,
  restorePurchase,
} from "./transactions.ts";
import { RouteLink, PaperTicket, NumberBalls } from "./RetailPrimitives.tsx";
import {
  PURCHASE_DRAFT_KEY,
  emptyDraft,
  parsePurchaseDraft,
  purchaseAction,
  purchaseDraftKey,
  type PurchaseAction,
  type PurchaseDraft,
} from "./purchaseDraft.ts";
import { resolveReferrer } from "./referral.ts";
import { UpcomingDrawTime } from "./UpcomingDrawTime.tsx";
import type { Route } from "./navigation.ts";

export function Purchase({
  draw,
  locale,
  urls,
  route,
  navigate,
  stale,
}: {
  stale: boolean;
  draw: Draw;
  locale: Locale;
  urls: string[];
  route: Route;
  navigate: (r: Route, replace?: boolean) => void;
}) {
  const p = playCopy(locale),
    c = clubCopy(locale),
    wallet = useWallet(),
    { openConnectModal } = useConnectModal();
  const [draft, setDraft] = useState<PurchaseDraft>(emptyDraft(draw.id));
  const changeDraft = (update: (draft: PurchaseDraft) => PurchaseDraft) =>
    setDraft((d) => ({ ...update(d), revision: (d.revision ?? 0) + 1 }));
  const [ready, setReady] = useState(false),
    [storageError, setStorageError] = useState(false),
    [editing, setEditing] = useState<{ row: number; slot: number } | null>(
      null,
    ),
    [help, setHelp] = useState(false);
  useEffect(() => {
    try {
      const saved = parsePurchaseDraft(
        JSON.parse(localStorage.getItem(PURCHASE_DRAFT_KEY) ?? "null"),
        draw,
      );
      setDraft({
        ...(saved ?? emptyDraft(draw.id)),
        draw: draw.id,
        ...(route.ref !== undefined ? { invitation: route.ref } : {}),
      });
    } catch {
      setStorageError(true);
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    setDraft((d) => (d.draw === draw.id ? d : { ...d, draw: draw.id }));
    try {
      localStorage.setItem(PURCHASE_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      setStorageError(true);
    }
  }, [draft, ready, draw.id]);
  const choose = route.choose ?? false,
    count = choose ? draft.rows.length : draft.quantity;
  const valid =
    !choose ||
    draft.rows.every((r) =>
      validNumbers(r.numbers, r.bonus, draw.ballMax, draw.bonusMax),
    );
  const open = !draw.locked;
  const randomRow = () => quickPick(draw.ballMax, draw.bonusMax);
  // Mode changes retain the quantity and complete previously uninitialized rows.
  useEffect(() => {
    if (!ready) return;
    setDraft((d) => {
      const mode = choose ? "choose" : "quick";
      if (
        d.mode === mode &&
        (!choose || d.rows.every((r) => r.numbers.length === 5))
      )
        return d;
      const quantity = d.mode === "choose" ? d.rows.length : d.quantity;
      return {
        ...d,
        mode,
        quantity,
        revision: (d.revision ?? 0) + 1,
        rows: choose
          ? Array.from({ length: quantity }, (_, i) => {
              const row = d.rows[i];
              return row && row.numbers.length === 5 ? row : randomRow();
            })
          : d.rows,
      };
    });
  }, [choose, ready]);
  useEffect(() => {
    if (ready && route.ref !== undefined)
      setDraft((d) =>
        d.invitation === route.ref
          ? d
          : { ...d, invitation: route.ref, revision: (d.revision ?? 0) + 1 },
      );
  }, [ready, route.ref]);
  let invalidInvitation = false;
  try {
    resolveReferrer(draft.invitation);
  } catch {
    invalidInvitation = true;
  }
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const updateRow = (numbers: number[], bonus: number) =>
    changeDraft((d) => ({
      ...d,
      rows: d.rows.map((r, i) => (i === editing?.row ? { numbers, bonus } : r)),
    }));
  const active = editing === null ? null : draft.rows[editing.row];
  const checkout = () => {
    const next = {
      ...draft,
      mode: choose ? ("choose" as const) : ("quick" as const),
    };
    setDraft(next);
    if (!valid) return;
    // The wallet library's connect dialog cannot stack above the native checkout dialog.
    if (!wallet.account && openConnectModal) openConnectModal();
    else navigate({ ...route, checkout: true });
  };
  const connectFromCheckout = () => {
    navigate({ ...route, checkout: undefined });
    openConnectModal?.();
  };

  /** @cc [label:security] explicit-purchase-steps
   * Restoring and reviewing an order never submits it. Each approval and purchase requires its
   * own click. Submitted account, order and draft identity remain immutable across navigation.
   */
  const [order, setOrder] = useState<PurchaseAction | null>(null),
    [review, setReview] = useState<Review | null>(null),
    [reviewRevision, setReviewRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const run = useRef(0),
    request = useRef<AbortController | null>(null),
    busyRef = useRef(false);
  const entries = useTransactions();
  const accountMatches =
    order?.recipient.toLowerCase() === wallet.account?.toLowerCase();
  const orderEntries =
    accountMatches && order
      ? entries.filter(
          (e) =>
            e.account.toLowerCase() === order.recipient.toLowerCase() &&
            e.chainId === 8453 &&
            e.purchase?.orderId === order.orderId,
        )
      : [];
  const entry = orderEntries.at(-1) ?? null;
  const done = entry?.kind === "purchase" && entry.status === "confirmed";
  const reviewValid =
    review !== null &&
    accountMatches &&
    wallet.chainId === 8453 &&
    wallet.revision === reviewRevision &&
    review.account.toLowerCase() === wallet.account?.toLowerCase();
  const stage =
    !wallet.account || wallet.chainId !== 8453
      ? "connect"
      : done
        ? "done"
        : entry && ["wallet", "pending", "unknown"].includes(entry.status)
          ? "sent"
          : entry && ["reverted", "replaced"].includes(entry.status)
            ? "failed"
            : !reviewValid
              ? "review"
              : review!.calls[0].kind === "approve"
                ? "approve"
                : "confirm";
  useEffect(() => {
    if (
      route.checkout &&
      order &&
      accountMatches &&
      orderEntries.some((e) =>
        ["wallet", "pending", "unknown", "confirmed"].includes(e.status),
      )
    )
      return;
    run.current++;
    request.current?.abort();
    request.current = null;
    busyRef.current = false;
    setBusy(false);
    setReview(null);
    setError("");
    setOrder(null);
    if (
      !route.checkout ||
      !ready ||
      !wallet.account ||
      invalidInvitation ||
      draft.mode !== (choose ? "choose" : "quick") ||
      !valid ||
      (route.ref !== undefined && route.ref !== draft.invitation)
    )
      return;
    const draftKey = purchaseDraftKey(draftRef.current);
    const previous = [...entries]
      .reverse()
      .find(
        (e) =>
          e.account.toLowerCase() === wallet.account!.toLowerCase() &&
          e.chainId === 8453 &&
          e.purchase &&
          (e.purchase.draftKey === draftKey ||
            ["wallet", "pending", "unknown"].includes(e.status)),
      );
    const restored = previous?.purchase
      ? restorePurchase(previous.purchase)
      : null;
    try {
      setOrder(
        restored ?? purchaseAction(draftRef.current, draw, wallet.account),
      );
    } catch (e) {
      setError(errorCopy(locale, e));
    }
    return () => {
      run.current++;
      request.current?.abort();
    };
  }, [
    route.checkout,
    ready,
    wallet.account,
    wallet.revision,
    draft.mode,
    route.ref,
    invalidInvitation,
    draft.invitation,
    valid,
  ]);
  const cleared = useRef(new Set<string>());
  useEffect(() => {
    if (!entry || !accountMatches) return;
    if (
      entry.kind === "purchase" &&
      entry.status === "confirmed" &&
      !cleared.current.has(entry.id)
    ) {
      cleared.current.add(entry.id);
      if (entry.purchase?.draftKey === purchaseDraftKey(draftRef.current)) {
        setDraft(emptyDraft(draw.id));
        navigate({ ...route, ref: undefined }, true);
      }
    } else if (entry.kind === "approve" && entry.status === "confirmed") {
      setReview(null);
      setError("");
    }
  }, [entry?.id, entry?.status, accountMatches]);
  const prepare = async () => {
    if (!order || busyRef.current || !accountMatches) return;
    const seq = ++run.current,
      controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await reviewAction(
        urls,
        order.recipient,
        order,
        controller.signal,
      );
      if (seq === run.current && !controller.signal.aborted) {
        setReview(next);
        setReviewRevision(wallet.revision);
      }
    } catch (e) {
      if (seq === run.current && !controller.signal.aborted) {
        setReview(null);
        setError(errorCopy(locale, e));
      }
    } finally {
      if (seq === run.current) {
        setBusy(false);
        busyRef.current = false;
      }
    }
  };
  useEffect(() => {
    if (
      route.checkout &&
      stage === "review" &&
      order &&
      !busyRef.current &&
      !error
    )
      void prepare();
  }, [route.checkout, stage, order?.orderId, wallet.revision, entry?.status]);
  useEffect(() => {
    if (
      !route.checkout ||
      !order ||
      !["approve", "confirm", "review"].includes(stage)
    )
      return;
    const refresh = () => {
      if (document.visibilityState === "visible") void prepare();
    };
    const interval = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [route.checkout, stage, order?.orderId, wallet.revision]);
  const send = async () => {
    if (
      !review ||
      !order ||
      busyRef.current ||
      !["approve", "confirm"].includes(stage)
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController(),
      seq = ++run.current;
    request.current?.abort();
    request.current = controller;
    try {
      await submitReview(
        urls,
        review,
        reviewRevision,
        controller.signal,
        (fresh) => {
          if (!controller.signal.aborted) {
            setReview(fresh);
            setReviewRevision(wallet.revision);
          }
        },
      );
    } catch (e) {
      if (!controller.signal.aborted) setError(errorCopy(locale, e));
    } finally {
      if (seq === run.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const retry = () => {
    setReview(null);
    setError("");
    setOrder(purchaseAction(draftRef.current, draw, wallet.account!));
  };
  const orderTickets = order?.tickets ?? (choose ? draft.rows : []);
  const orderCount = order ? order.tickets.length : count;
  const orderTotal = (
    reviewValid
      ? BigInt(review!.amount)
      : (order ? order.unitPrice : BigInt(draw.ticketPrice)) *
        BigInt(orderCount)
  ).toString();
  const totalText = `$${money(done && entry?.purchaseReceipt ? entry.purchaseReceipt.paid : orderTotal, locale, 2)}`;
  const call = reviewValid ? review!.calls[0] : null;
  return (
    <section className="retail-page purchase-page">
      <div className="retail-page-title">
        <RouteLink
          to={{ view: "draw" }}
          navigate={navigate}
          className="round-control"
          label={p("back")}
        >
          <ArrowLeft size={21} />
        </RouteLink>
        <h1>{p("buyTickets")}</h1>
        <button
          className="round-control"
          onClick={() => setHelp(true)}
          aria-label={p("howToPlay")}
        >
          <CircleHelp size={21} />
        </button>
      </div>
      <nav className="retail-segment" aria-label={p("buyTickets")}>
        <RouteLink
          to={{ view: "play", ref: draft.invitation }}
          navigate={navigate}
          className={!choose ? "selected" : ""}
        >
          <Sparkles size={19} />
          {p("quickPlay")}
        </RouteLink>
        <RouteLink
          to={{ view: "play", choose: true, ref: draft.invitation }}
          navigate={navigate}
          className={choose ? "selected" : ""}
        >
          <Pencil size={19} />
          {p("choose")}
        </RouteLink>
      </nav>
      {stale && (
        <p className="inline-notice" role="status">
          {p("updatesDelayed")}
        </p>
      )}
      {invalidInvitation && (
        <p className="form-error" role="alert">
          {p("invalidInvitation")}{" "}
          <button
            className="text-button"
            onClick={() => {
              changeDraft((d) => ({ ...d, invitation: undefined }));
              navigate({ ...route, ref: undefined, checkout: undefined }, true);
            }}
          >
            {p("clearInvitation")}
          </button>
        </p>
      )}
      {storageError && (
        <p className="inline-notice">{p("storageUnavailable")}</p>
      )}
      {!choose ? (
        <>
          <div className="ticket-stage">
            <div className="ticket-stage-time">
              <UpcomingDrawTime timestamp={draw.closesAt} locale={locale} />
            </div>
            <PaperTicket
              numbers={[]}
              bonus={null}
              locale={locale}
              count={count}
            />
          </div>
          <div className="quantity-heading">
            <h2>{p("tickets")}</h2>
            <div className="quantity-presets">
              {[10, 50, 100].map((n) => (
                <button
                  className={draft.quantity === n ? "selected" : ""}
                  key={n}
                  onClick={() => changeDraft((d) => ({ ...d, quantity: n }))}
                >
                  {n}
                </button>
              ))}
              <label htmlFor="ticket-quantity">{p("custom")}</label>
            </div>
          </div>
          <div className="quantity-stepper">
            <button
              disabled={draft.quantity <= 1}
              aria-label={p("fewer")}
              onClick={() =>
                changeDraft((d) => ({
                  ...d,
                  quantity: Math.max(1, d.quantity - 1),
                }))
              }
            >
              <Minus />
            </button>
            <input
              id="ticket-quantity"
              aria-label={p("quantity")}
              type="number"
              min="1"
              max="100"
              value={draft.quantity}
              onChange={(e) => {
                const n = Number(e.target.value);
                changeDraft((d) => ({
                  ...d,
                  quantity: Number.isInteger(n)
                    ? Math.max(1, Math.min(100, n))
                    : 1,
                }));
              }}
            />
            <button
              disabled={draft.quantity >= 100}
              aria-label={p("more")}
              onClick={() =>
                changeDraft((d) => ({
                  ...d,
                  quantity: Math.min(100, d.quantity + 1),
                }))
              }
            >
              <Plus />
            </button>
          </div>
        </>
      ) : (
        <div className="chosen-tickets compact-choices">
          <div className="bulk-ticket-tools">
            <button
              className="button button-outline"
              disabled={draft.rows.length >= 100}
              onClick={() =>
                changeDraft((d) => ({
                  ...d,
                  rows: [...d.rows, randomRow()],
                  quantity: d.rows.length + 1,
                }))
              }
            >
              <Plus size={17} />
              {p("add")}
            </button>
            <button
              className="text-button"
              onClick={() =>
                changeDraft((d) => ({ ...d, rows: d.rows.map(randomRow) }))
              }
            >
              <Shuffle size={17} />
              {p("shuffleAll")}
            </button>
          </div>
          {draft.rows.map((row, i) => (
            <article className="compact-ticket-row" key={i}>
              <span
                className="ticket-row-index"
                aria-label={p("number", { number: i + 1 })}
              >
                {i + 1}
              </span>
              <div className="editable-balls">
                {[...row.numbers, row.bonus].map((number, slot) => (
                  <button
                    key={slot}
                    className={`editable-ball ${slot === 5 ? "bonus" : ""}`}
                    aria-label={`${p("number", { number: i + 1 })} · ${slot === 5 ? p("bonus") : p("numbersLabel")} ${number}`}
                    onClick={() => setEditing({ row: i, slot })}
                  >
                    {number}
                  </button>
                ))}
              </div>
              <button
                className="compact-remove"
                disabled={draft.rows.length <= 1}
                aria-label={`${p("remove")} ${i + 1}`}
                onClick={() =>
                  changeDraft((d) => ({
                    ...d,
                    rows: d.rows.filter((_, n) => n !== i),
                    quantity: d.rows.length - 1,
                  }))
                }
              >
                <Trash2 size={16} />
              </button>
            </article>
          ))}
        </div>
      )}
      <div className="purchase-total">
        <span>{p("ticketPrice")}</span>
        <strong>{money(draw.ticketPrice, locale, 2)} USDC</strong>
      </div>
      <button
        className="button button-primary purchase-cta"
        disabled={!ready || !valid || !open || invalidInvitation}
        onClick={checkout}
      >
        {p("buyTickets")} $
        {money(
          (BigInt(draw.ticketPrice) * BigInt(count)).toString(),
          locale,
          2,
        )}
        <ArrowRight size={19} />
      </button>
      {!open && (
        <p role="status" className="inline-notice">
          {p("drawClosed")}
        </p>
      )}
      <section className="learn-section">
        <h2>{p("learnMore")}</h2>
        <button className="learn-card" onClick={() => setHelp(true)}>
          <CircleHelp size={28} />
          <strong>{p("howToPlay")}</strong>
          <span>{p("howToPlayDetail")}</span>
        </button>
      </section>
      {active && (
        <Modal
          title={p("pickNumbers")}
          closeLabel={p("close")}
          onClose={() => setEditing(null)}
        >
          <div
            className={`number-picker ${editing?.slot === 5 ? "bonus-picker" : ""}`}
          >
            {Array.from(
              { length: editing?.slot === 5 ? draw.bonusMax : draw.ballMax },
              (_, i) => i + 1,
            ).map((n) => (
              <button
                key={n}
                aria-pressed={
                  editing?.slot === 5
                    ? active.bonus === n
                    : active.numbers[editing!.slot] === n
                }
                disabled={
                  editing?.slot !== 5 &&
                  active.numbers.includes(n) &&
                  active.numbers[editing!.slot] !== n
                }
                onClick={() => {
                  if (editing?.slot === 5) updateRow(active.numbers, n);
                  else
                    updateRow(
                      active.numbers
                        .map((old, slot) => (slot === editing!.slot ? n : old))
                        .sort((a, b) => a - b),
                      active.bonus,
                    );
                  setEditing(null);
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            className="button button-primary full-width"
            disabled={active.numbers.length !== 5}
            onClick={() => setEditing(null)}
          >
            <Check size={18} />
            {p("done")}
          </button>
        </Modal>
      )}
      {route.checkout && (
        <Modal
          title={done ? p("confirmed") : p("checkout")}
          closeLabel={p("close")}
          onClose={() => navigate({ ...route, checkout: undefined })}
        >
          <div className="checkout-ticket">
            <PaperTicket
              numbers={orderTickets[0]?.numbers ?? []}
              bonus={orderTickets[0]?.bonus ?? null}
              locale={locale}
              count={orderCount}
            />
          </div>
          {orderTickets.length > 0 && (
            <details className="checkout-selections">
              <summary>{p("reviewTickets", { count: orderCount })}</summary>
              {orderTickets.map((row, index) => (
                <div key={index}>
                  <span>{p("number", { number: index + 1 })}</span>
                  <NumberBalls numbers={row.numbers} bonus={row.bonus} small />
                </div>
              ))}
            </details>
          )}
          <dl className="checkout-summary">
            <dt>{p("tickets")}</dt>
            <dd>{orderCount.toLocaleString(locale)}</dd>
            {!done && (
              <>
                <dt>{p("drawTime")}</dt>
                <dd>
                  <UpcomingDrawTime timestamp={draw.closesAt} locale={locale} />
                </dd>
              </>
            )}
            <dt>{p("payment")}</dt>
            <dd>USDC · Base</dd>
            <dt>{p("total")}</dt>
            <dd>{totalText}</dd>
          </dl>
          <div className="checkout-actions">
            {stage === "connect" && (
              <>
                {error && (
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                )}
                {!wallet.account ? (
                  <button
                    className="button button-primary full-width"
                    onClick={connectFromCheckout}
                  >
                    {c("connect")}
                  </button>
                ) : (
                  <button
                    className="button button-primary full-width"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      setError("");
                      switchBase(urls)
                        .catch((e) => setError(errorCopy(locale, e)))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {c("switchBase")}
                  </button>
                )}
              </>
            )}
            {stage === "done" && (
              <>
                <p role="status" className="checkout-confirmed">
                  <Check size={20} />
                  {p("confirmationDetail")}
                </p>
                {entry?.hash && (
                  <a
                    className="text-button"
                    href={`${EXPLORER}/tx/${entry.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {p("viewTransaction")}
                    <ExternalLink size={16} />
                  </a>
                )}
                <RouteLink
                  to={{
                    view: "tickets",
                    draw: entry?.purchaseReceipt?.draw ?? draw.id,
                  }}
                  navigate={navigate}
                  className="button button-primary full-width"
                >
                  {p("viewTickets")}
                  <ArrowRight size={19} />
                </RouteLink>
              </>
            )}
            {stage === "sent" && entry && (
              <>
                <p role="status" className="inline-notice" aria-busy="true">
                  {entry.status === "wallet"
                    ? c("wallet")
                    : entry.status === "unknown"
                      ? c("ambiguousTransaction")
                      : entry.kind === "approve"
                        ? p("approvalPending")
                        : p("purchaseSubmitted")}
                </p>
                {entry.status === "unknown" && (
                  <RouteLink
                    to={{ view: "winnings", section: "activity" }}
                    navigate={navigate}
                    className="text-button"
                  >
                    {c("activity")}
                    <ArrowRight size={17} />
                  </RouteLink>
                )}
                {entry.hash && (
                  <a
                    className="text-button"
                    href={`${EXPLORER}/tx/${entry.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {p("viewTransaction")}
                    <ExternalLink size={16} />
                  </a>
                )}
              </>
            )}
            {stage === "failed" && entry && (
              <>
                <p role="alert" className="form-error">
                  {entry.kind === "purchase" && entry.status === "reverted"
                    ? p("purchaseReverted")
                    : c(entry.status)}
                </p>
                <button
                  className="button button-primary full-width"
                  onClick={retry}
                >
                  {p("tryAgain")}
                </button>
              </>
            )}
            {stage === "approve" && (
              <p className="inline-notice">
                {p("approveHelp", { amount: money(orderTotal, locale, 2) })}
              </p>
            )}
            {(stage === "review" ||
              stage === "approve" ||
              stage === "confirm") && (
              <>
                {error && (
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                )}
                {reviewValid && review!.position.contractWallet && (
                  <p className="inline-notice">{c("contractWallet")}</p>
                )}
                {stage === "review" ? (
                  <button
                    className="button button-primary full-width"
                    disabled={busy || !order}
                    onClick={() => void prepare()}
                  >
                    {busy && <LoaderCircle size={18} className="spinning" />}
                    {busy
                      ? p("reviewing")
                      : error
                        ? p("tryAgain")
                        : p("reviewPurchase")}
                  </button>
                ) : (
                  <button
                    className="button button-primary full-width"
                    disabled={busy || review!.position.contractWallet}
                    onClick={() => void send()}
                  >
                    {busy
                      ? c("working")
                      : stage === "approve"
                        ? p("approveAmount", {
                            amount: money(orderTotal, locale, 2),
                          })
                        : `${p("confirmPurchase")} · ${totalText}`}
                    <ArrowRight size={19} />
                  </button>
                )}
                {call && (
                  <details className="call-inspector">
                    <summary>{c("rawTransaction")}</summary>
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
                      <dd>#{review!.block.toString()}</dd>
                      <dt>{c("connected")}</dt>
                      <dd>
                        <code>{review!.account}</code>
                      </dd>
                    </dl>
                    <p>{c("exactCall")}:</p>
                    <code>{call.data}</code>
                    <p>value: 0 ETH · {review!.calls.length} transaction(s)</p>
                  </details>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
      {help && (
        <Modal
          title={p("howToPlay")}
          closeLabel={p("close")}
          onClose={() => setHelp(false)}
        >
          <p>{p("howToPlayDetail")}</p>
          <p>{p("pickHelp", { max: draw.ballMax, bonus: draw.bonusMax })}</p>
          <h3>{p("prizes")}</h3>
          <p>{p("prizesDetail")}</p>
          <a
            className="text-button"
            href="https://docs.megapot.io"
            target="_blank"
            rel="noreferrer"
          >
            {p("protocolInfo")} ↗
          </a>
        </Modal>
      )}
    </section>
  );
}
