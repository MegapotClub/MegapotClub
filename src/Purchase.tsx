import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Minus,
  Plus,
  Shuffle,
  Sparkles,
  Pencil,
  Trash2,
} from "lucide-react";
import type { Locale } from "./i18n.ts";
import { money, phase, type Draw } from "./model.ts";
import { quickPick, validNumbers } from "./plans.ts";
import { playCopy } from "./playCopy.ts";
import { Modal } from "./Modal.tsx";
import { DrawTime } from "./drawTime.tsx";
import { WalletButton } from "./WalletButton.tsx";
import { useWallet } from "./wallet.ts";
import { RouteLink, PaperTicket, NumberBalls } from "./RetailPrimitives.tsx";
import {
  PURCHASE_DRAFT_KEY,
  parsePurchaseDraft,
  purchaseIntent,
  type PurchaseDraft,
} from "./purchaseDraft.ts";
import type { Route } from "./navigation.ts";

export function Purchase({
  draw,
  locale,
  route,
  navigate,
  observedAt,
  stale,
}: {
  observedAt: number;
  stale: boolean;
  draw: Draw;
  locale: Locale;
  route: Route;
  navigate: (r: Route, replace?: boolean) => void;
}) {
  const p = playCopy(locale),
    wallet = useWallet();
  const [draft, setDraft] = useState<PurchaseDraft>({
    schema: 1,
    draw: draw.id,
    quantity: 10,
    rows: [{ numbers: [], bonus: 1 }],
    mode: "quick",
  });
  const [ready, setReady] = useState(false),
    [storageError, setStorageError] = useState(false),
    [changed, setChanged] = useState(false),
    [editing, setEditing] = useState<number | null>(null),
    [help, setHelp] = useState(false);
  useEffect(() => {
    try {
      const saved = parsePurchaseDraft(
        JSON.parse(localStorage.getItem(PURCHASE_DRAFT_KEY) ?? "null"),
        draw,
      );
      if (saved) {
        setChanged(saved.draw !== draw.id);
        setDraft({ ...saved, draw: draw.id });
      }
    } catch {
      setStorageError(true);
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    setDraft((d) => (d.draw === draw.id ? d : { ...d, draw: draw.id }));
    if (draft.draw !== draw.id) setChanged(true);
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
  const open = phase(draw, Date.now()) === "open";
  const updateRow = (numbers: number[], bonus: number) =>
    setDraft((d) => ({
      ...d,
      rows: d.rows.map((r, i) => (i === editing ? { numbers, bonus } : r)),
    }));
  const active = editing === null ? null : draft.rows[editing];
  const checkout = () => {
    const next = {
      ...draft,
      mode: choose ? ("choose" as const) : ("quick" as const),
    };
    setDraft(next);
    if (valid) {
      purchaseIntent(next, draw, wallet.account, route.ref);
      navigate({ ...route, checkout: true });
    }
  };
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
          to={{ view: "play", ref: route.ref }}
          navigate={navigate}
          className={!choose ? "selected" : ""}
        >
          <Sparkles size={19} />
          {p("quickPlay")}
        </RouteLink>
        <RouteLink
          to={{ view: "play", choose: true, ref: route.ref }}
          navigate={navigate}
          className={choose ? "selected" : ""}
        >
          <Pencil size={19} />
          {p("choose")}
        </RouteLink>
      </nav>
      <p className="purchase-provenance">
        {p("lastChecked")} ·{" "}
        {new Date(observedAt * 1000).toLocaleString(locale)}
        {stale ? ` · ${p("estimate")}` : ""}
      </p>
      {changed && <p className="inline-notice">{p("selectionExpired")}</p>}
      {storageError && (
        <p className="inline-notice">{p("storageUnavailable")}</p>
      )}
      {!choose ? (
        <>
          <div className="ticket-stage">
            <div className="ticket-stage-time">
              <DrawTime timestamp={draw.closesAt} locale={locale} />
            </div>
            <PaperTicket numbers={[]} bonus={null} locale={locale} />
            <p>{p("quickHelp")}</p>
          </div>
          <div className="quantity-heading">
            <h2>{p("tickets")}</h2>
            <div className="quantity-presets">
              {[10, 50, 100].map((n) => (
                <button
                  className={draft.quantity === n ? "selected" : ""}
                  key={n}
                  onClick={() => setDraft((d) => ({ ...d, quantity: n }))}
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
                setDraft((d) => ({
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
                setDraft((d) => ({
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
                setDraft((d) => ({
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
        <div className="chosen-tickets">
          {draft.rows.map((row, i) => (
            <article className="chosen-ticket" key={i}>
              <div className="section-top">
                <span>{p("number", { number: i + 1 })}</span>
                <div>
                  <button
                    className="icon-button"
                    aria-label={`${p("shuffle")} ${i + 1}`}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        rows: d.rows.map((r, j) =>
                          j === i ? quickPick(draw.ballMax, draw.bonusMax) : r,
                        ),
                      }))
                    }
                  >
                    <Shuffle size={18} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={draft.rows.length === 1}
                    aria-label={`${p("remove")} ${i + 1}`}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        rows: d.rows.filter((_, j) => j !== i),
                      }))
                    }
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              <button
                className="number-edit-button"
                aria-label={`${p("pickNumbers")} · ${i + 1}`}
                onClick={() => setEditing(i)}
              >
                <NumberBalls
                  numbers={Array.from(
                    { length: 5 },
                    (_, n) => row.numbers[n] ?? 0,
                  )}
                  bonus={row.bonus}
                />
                <Pencil size={17} />
              </button>
            </article>
          ))}
          <button
            className="button button-outline full-width"
            disabled={draft.rows.length >= 100}
            onClick={() => {
              const index = draft.rows.length;
              setDraft((d) => ({
                ...d,
                rows: [...d.rows, { numbers: [], bonus: 1 }],
              }));
              setEditing(index);
            }}
          >
            <Plus size={18} />
            {p("add")}
          </button>
        </div>
      )}
      <div className="purchase-total">
        <span>{p("ticketPrice")}</span>
        <strong>{money(draw.ticketPrice, locale, 2)} USDC</strong>
      </div>
      <button
        className="button button-primary purchase-cta"
        disabled={!ready || !valid || !open}
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
      <p className="selection-note">{p("selectionOnly")}</p>
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
          <p>{p("pickHelp", { max: draw.ballMax, bonus: draw.bonusMax })}</p>
          <div className="picker-tools">
            <button
              className="text-button"
              onClick={() => {
                const r = quickPick(draw.ballMax, draw.bonusMax);
                updateRow(r.numbers, r.bonus);
              }}
            >
              <Shuffle size={18} />
              {p("shuffle")}
            </button>
            <button className="text-button" onClick={() => updateRow([], 1)}>
              {p("clear")}
            </button>
          </div>
          <div className="number-picker">
            {Array.from({ length: draw.ballMax }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                aria-pressed={active.numbers.includes(n)}
                disabled={
                  active.numbers.length === 5 && !active.numbers.includes(n)
                }
                onClick={() =>
                  updateRow(
                    active.numbers.includes(n)
                      ? active.numbers.filter((x) => x !== n)
                      : [...active.numbers, n].sort((a, b) => a - b),
                    active.bonus,
                  )
                }
              >
                {n}
              </button>
            ))}
          </div>
          <h3>{p("bonus")}</h3>
          <div className="number-picker bonus-picker">
            {Array.from({ length: draw.bonusMax }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                aria-pressed={active.bonus === n}
                onClick={() => updateRow(active.numbers, n)}
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
          title={p("checkout")}
          closeLabel={p("close")}
          onClose={() => navigate({ ...route, checkout: undefined })}
        >
          <div className="checkout-ticket">
            <PaperTicket
              numbers={choose ? draft.rows[0].numbers : []}
              bonus={choose ? draft.rows[0].bonus : null}
              locale={locale}
            />
          </div>
          {choose && (
            <details className="checkout-selections">
              <summary>{p("reviewTickets", { count })}</summary>
              {draft.rows.map((row, index) => (
                <div key={index}>
                  <span>{p("number", { number: index + 1 })}</span>
                  <NumberBalls numbers={row.numbers} bonus={row.bonus} small />
                </div>
              ))}
            </details>
          )}
          <dl className="checkout-summary">
            <dt>{p("tickets")}</dt>
            <dd>{count.toLocaleString(locale)}</dd>
            <dt>{p("drawTime")}</dt>
            <dd>
              <DrawTime timestamp={draw.closesAt} locale={locale} />
            </dd>
            <dt>{p("payment")}</dt>
            <dd>USDC · Base</dd>
            {route.ref && (
              <>
                <dt>{p("referralAddress")}</dt>
                <dd>
                  <code>
                    {route.ref.slice(0, 8)}…{route.ref.slice(-6)}
                  </code>
                </dd>
              </>
            )}
            <dt>{p("total")}</dt>
            <dd>
              $
              {money(
                (BigInt(draw.ticketPrice) * BigInt(count)).toString(),
                locale,
                2,
              )}
            </dd>
          </dl>
          {!wallet.account && <WalletButton locale={locale} />}
          <p className="inline-notice">{p("purchaseBoundary")}</p>
          <button className="button button-primary full-width" disabled>
            {p("purchasePending")}
          </button>
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
