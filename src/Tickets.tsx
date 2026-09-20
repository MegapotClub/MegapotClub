import { useDelayedStatus } from "./useDelayedStatus.ts";
import { WinShare } from "./WinShare.tsx";
import { Identity } from "./Identity.tsx";
import { useState, type ReactNode } from "react";
import { readWalletDrawWins } from "./megapotApi.ts";
import { useQuery } from "@tanstack/react-query";
import { getAddress, isAddress } from "viem";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  RefreshCw,
  Search,
  Ticket,
  Wallet,
  X,
} from "lucide-react";
import { useWalletReady } from "./WalletProviders.tsx";
import { WalletButton } from "./WalletButton.tsx";
import { useWallet } from "./wallet.ts";
import type { Locale, Messages } from "./i18n.ts";
import { interpolate } from "./i18n.ts";
import type { Snapshot, TicketRecord, Draw } from "./model.ts";
import { normalNavigation, routeHref, type Route } from "./navigation.ts";
import { ticketScope, ticketQueryOptions } from "./ticketQuery.ts";
import { ticketCopy } from "./ticketCopy.ts";
import { DrawTime } from "./drawTime.tsx";
import { experienceCopy } from "./experienceCopy.ts";
import { PaperTicket, NumberBalls, RouteLink } from "./RetailPrimitives.tsx";
import { playCopy } from "./playCopy.ts";
import { UpcomingDrawTime } from "./UpcomingDrawTime.tsx";
import { EXPLORER } from "./config.ts";
import { mainMatches, ticketsByMatches } from "./ticketDisplay.ts";
import { money } from "./model.ts";
import type { PlayerObservation } from "./playerReads.ts";

const PAGE_SIZE = 12;

function TicketNumbers({
  ticket,
  draw,
  m,
  matchLabel,
}: {
  ticket: TicketRecord;
  draw: Draw;
  m: Messages;
  matchLabel: string;
}) {
  const numbers = [...ticket.numbers].sort((a, b) => a - b);
  return (
    <div className="ticket-numbers" role="group" aria-label={m.normalNumbers}>
      {numbers.map((n) => {
        const matched = draw.result?.numbers.includes(n);
        return (
          <span
            key={n}
            className={`ticket-number ${draw.result ? (matched ? "matched" : "unmatched") : ""}`}
            aria-label={`${n}${matched ? ` · ${matchLabel}` : ""}`}
          >
            {String(n).padStart(2, "0")}
            {matched && <Check size={10} aria-hidden="true" />}
          </span>
        );
      })}
      <span className="ticket-number-divider" aria-hidden="true">
        +
      </span>
      <span
        className={`ticket-number ticket-bonus ${draw.result ? (draw.result.bonus === ticket.bonus ? "matched" : "unmatched") : ""}`}
        aria-label={`${m.bonusNumber} ${ticket.bonus}${draw.result?.bonus === ticket.bonus ? ` · ${matchLabel}` : ""}`}
      >
        {String(ticket.bonus).padStart(2, "0")}
        {draw.result?.bonus === ticket.bonus && (
          <Check size={10} aria-hidden="true" />
        )}
      </span>
    </div>
  );
}

export function Tickets({
  locale,
  messages: m,
  urls,
  snapshot,
  route,
  navigate,
  player,
}: {
  locale: Locale;
  messages: Messages;
  urls: string[];
  snapshot: Snapshot;
  route: Route;
  navigate: (route: Route, replace?: boolean) => void;
  player?: PlayerObservation;
}) {
  const wallet = useWallet();
  const walletReady = useWalletReady();
  const scope = ticketScope(
    route,
    wallet.account ?? undefined,
    snapshot.current.id,
  );
  const archive = false;
  const query = useQuery({
    ...ticketQueryOptions(urls, scope),
    enabled: Boolean(scope.address) && !archive,
  });
  const observation = query.data;
  const stale = Boolean(
    observation &&
      (query.isError || Date.now() - observation.blockTime * 1000 > 120_000),
  );
  const delayed = useDelayedStatus(stale);
  const [editingAddress, setEditingAddress] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const t = ticketCopy(locale);
  const e = experienceCopy(locale);
  const draw =
    observation?.draw ??
    [snapshot.current, ...snapshot.recent].find((d) => d.id === scope.drawId);
  const own = Boolean(
    wallet.account &&
      wallet.account.toLowerCase() === scope.address?.toLowerCase(),
  );
  const pages = Math.max(1, Math.ceil((observation?.total ?? 0) / PAGE_SIZE));
  const page = Math.min(route.page ?? 1, pages);
  const visible = observation
    ? ticketsByMatches(observation.tickets, observation.draw).slice(
        (page - 1) * PAGE_SIZE,
        page * PAGE_SIZE,
      )
    : [];
  const historicalAwards = useQuery({
    queryKey: [
      "megapot-api",
      "wallet-draw-wins",
      scope.address?.toLowerCase(),
      scope.drawId,
    ],
    queryFn: ({ signal }) =>
      readWalletDrawWins(scope.address!, scope.drawId, signal),
    enabled: own && !archive && Boolean(draw?.settled),
    staleTime: 300_000,
    retry: false,
  });
  const amounts = new Map(
    player && player.account.toLowerCase() === scope.address?.toLowerCase()
      ? player!.settledTickets
          .filter((ticket) => ticket.draw.id.toString() === scope.drawId)
          .map((ticket) => [ticket.ticketId.toString(), ticket.net] as const)
      : [],
  );
  for (const win of historicalAwards.data?.data ?? [])
    if (!amounts.has(win.user_ticket_id))
      amounts.set(win.user_ticket_id, BigInt(win.amount.amount));
  const integer = (n: number) => new Intl.NumberFormat(locale).format(n);
  const past = archive || scope.drawId !== snapshot.current.id;
  const archiveRoute: Route = {
    view: "tickets",
    address: route.address,
    period: "past",
  };
  const selectDraw = (id: string): Route => ({
    view: "tickets",
    address: route.address,
    draw: id === snapshot.current.id ? undefined : id,
  });
  const link = (
    next: Route,
    children: ReactNode,
    className = "text-button",
    label?: string,
  ) => (
    <a
      className={className}
      href={routeHref(next)}
      aria-label={label}
      onClick={(e) => {
        if (normalNavigation(e)) {
          e.preventDefault();
          navigate(next);
        }
      }}
    >
      {children}
    </a>
  );
  const p = playCopy(locale);

  return (
    <section className="subpage tickets-page" aria-labelledby="tickets-title">
      <div className="retail-page-title">
        <RouteLink
          to={{ view: "tickets", address: route.address }}
          navigate={navigate}
          className="round-control"
          label={p("back")}
        >
          <ArrowLeft size={20} />
        </RouteLink>
        <h1 id="tickets-title" tabIndex={-1}>
          {p("tickets")}
        </h1>

        <RouteLink
          to={{ view: "play" }}
          navigate={navigate}
          className="button button-primary"
        >
          {p("addTickets")}
        </RouteLink>
      </div>
      <div className="ticket-owner-bar">
        {scope.address ? (
          <div className="ticket-owner">
            <Wallet size={19} />
            <span>
              {scope.public ? t("viewingAddress") : t("connectedWallet")}
            </span>
            <a
              href={`${EXPLORER}/address/${scope.address}`}
              target="_blank"
              rel="noreferrer"
              title={scope.address}
              aria-label={`${m.viewOnBase}: ${scope.address}`}
            >
              <Identity address={scope.address} />
            </a>
          </div>
        ) : (
          <span className="ticket-owner">
            <Wallet size={19} />
            {t("connectHint")}
          </span>
        )}
        <div className="ticket-owner-actions">
          {scope.public &&
            link(
              { view: "tickets", draw: route.draw },
              <>
                {m.tickets}
                <ArrowRight size={16} />
              </>,
            )}
          <button
            className="text-button"
            aria-expanded={editingAddress}
            aria-controls="ticket-address-form"
            onClick={() => {
              setEditingAddress((v) => !v);
              setDraft(route.address ?? "");
              setInvalid(false);
            }}
          >
            {editingAddress ? <X size={16} /> : <Search size={16} />}
            {editingAddress ? m.close : t("anotherAddress")}
          </button>
        </div>
      </div>
      {editingAddress && (
        <form
          id="ticket-address-form"
          className="ticket-address-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isAddress(draft.trim(), { strict: false })) {
              setInvalid(true);
              return;
            }
            navigate({
              view: "tickets",
              address: getAddress(draft.trim()),
              ...(archive
                ? { period: "past" as const }
                : { draw: scope.drawId }),
            });
            setEditingAddress(false);
            setInvalid(false);
            requestAnimationFrame(() =>
              document.getElementById("tickets-title")?.focus(),
            );
          }}
        >
          <label htmlFor="public-address">{m.address}</label>
          <div className="ticket-address-input">
            <input
              id="public-address"
              autoFocus
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setInvalid(false);
              }}
              placeholder={m.addressPlaceholder}
              maxLength={42}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="none"
              required
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? "ticket-address-error" : undefined}
            />
            <button className="button button-primary" type="submit">
              {m.lookup}
              <ArrowRight size={17} />
            </button>
          </div>
          {invalid && (
            <p id="ticket-address-error" className="form-error" role="alert">
              {m.invalidAddress}
            </p>
          )}
        </form>
      )}

      {scope.address && (
        <nav className="collection-tabs" aria-label={e("collection")}>
          {([false, true] as const).map((isPast) => {
            const next = isPast
              ? archiveRoute
              : selectDraw(snapshot.current.id);
            return (
              <a
                key={String(isPast)}
                href={routeHref(next)}
                aria-current={past === isPast ? "page" : undefined}
                onClick={(event) => {
                  if (normalNavigation(event)) {
                    event.preventDefault();
                    navigate(next);
                  }
                }}
              >
                {e(isPast ? "past" : "upcoming")}
              </a>
            );
          })}
        </nav>
      )}
      {!scope.address && (!walletReady || wallet.connecting) ? (
        <p role="status" className="inline-notice">
          {t("restoring")}
        </p>
      ) : !scope.address ? (
        <div className="ticket-welcome">
          <span className="ticket-welcome-mark" aria-hidden="true">
            <Ticket size={42} strokeWidth={1.4} />
          </span>
          <h2>{t("connectTitle")}</h2>
          <p>{t("connectDetail")}</p>
          <WalletButton locale={locale} />
          <span className="fine-print">{t("readOnly")}</span>
        </div>
      ) : (
        <>
          {query.isError && (
            <div className="ticket-read-error" role="alert">
              <div>
                <strong>{t("readFailed")}</strong>
                <p>{observation ? t("keptResults") : t("retryHelp")}</p>
              </div>

              {link({ ...route, detail: "settings" }, m.settings)}
            </div>
          )}
          {!observation && query.isPending && (
            <div className="ticket-loading" role="status">
              <div className="ticket-loading-label">
                <RefreshCw size={18} className="spinning" />
                {t("loading")}
              </div>
              <div className="ticket-grid" aria-hidden="true">
                {[1, 2, 3].map((n) => (
                  <div className="ticket-skeleton" key={n}>
                    <span />
                    <i />
                    <span />
                  </div>
                ))}
              </div>
            </div>
          )}
          {observation && (
            <>
              <div className="ticket-detail-stage">
                {draw?.result ? (
                  <NumberBalls
                    numbers={draw.result.numbers}
                    bonus={draw.result.bonus}
                  />
                ) : (
                  <PaperTicket
                    numbers={observation.tickets[0]?.numbers ?? []}
                    bonus={observation.tickets[0]?.bonus ?? null}
                    locale={locale}
                    count={observation.total}
                  />
                )}
                {draw?.settled && <h2>{p("drawResult")}</h2>}
                {!draw?.settled && draw && (
                  <div className="detail-countdown">
                    <UpcomingDrawTime
                      timestamp={draw.closesAt}
                      locale={locale}
                    />
                  </div>
                )}
                {draw && <DrawTime timestamp={draw.closesAt} locale={locale} />}
              </div>
              {observation.total === 0 ? (
                <div className="ticket-zero">
                  <Ticket size={32} strokeWidth={1.4} />
                  <h3>{t("noTickets")}</h3>
                  <p>{t("noTicketsHelp")}</p>
                  {BigInt(scope.drawId) > 1n &&
                    link(
                      archiveRoute,
                      <>
                        <ArrowLeft size={16} />
                        {e("past")}
                      </>,
                      "button button-secondary",
                    )}
                </div>
              ) : (
                <>
                  {draw?.settled && (
                    <div className="ticket-result-note">
                      <span>
                        <Check size={15} />
                        {t("matchHelp")}
                      </span>
                      {link(
                        { view: "results", draw: scope.drawId },
                        <>
                          {m.viewResult}
                          <ArrowRight size={15} />
                        </>,
                      )}
                    </div>
                  )}
                  <h3 className="collection-numbers-title">
                    {scope.public ? m.normalNumbers : e("allNumbers")}
                  </h3>
                  <div className="ticket-grid">
                    {visible.map((ticket) => (
                      <article className="collection-ticket" key={ticket.id}>
                        <TicketNumbers
                          ticket={ticket}
                          draw={observation.draw}
                          m={m}
                          matchLabel={t("matched")}
                        />
                        <footer>
                          <span>
                            {draw?.settled
                              ? interpolate(t("mainMatches"), {
                                  count: mainMatches(ticket, draw),
                                })
                              : p("upcoming")}
                          </span>
                          <span>
                            {draw?.settled &&
                            draw.result?.bonus === ticket.bonus
                              ? t("bonusMatched")
                              : m.bonusShort}
                          </span>
                        </footer>
                        {draw?.settled &&
                          own &&
                          link(
                            { view: "winnings", ticket: ticket.id },
                            <>
                              <span className="ticket-prize-summary">
                                {(amounts.get(ticket.id) ?? 0n) > 0n && (
                                  <strong>
                                    {p("amountWon", {
                                      amount: money(
                                        amounts.get(ticket.id)!.toString(),
                                        locale,
                                        2,
                                      ),
                                    })}
                                  </strong>
                                )}
                                <span>{e("reviewPrize")}</span>
                              </span>
                              <ArrowRight size={16} />
                            </>,
                            "ticket-prize-link",
                          )}
                        {draw?.settled &&
                          own &&
                          (amounts.get(ticket.id) ?? 0n) > 0n && (
                            <WinShare
                              win={{
                                amount: amounts.get(ticket.id)!.toString(),
                                account: scope.address!,
                                date: draw.closesAt,
                              }}
                              locale={locale}
                            />
                          )}
                      </article>
                    ))}
                  </div>
                  {pages > 1 && (
                    <nav
                      className="ticket-pagination"
                      aria-label={t("ticketPages")}
                    >
                      {page > 1 ? (
                        link(
                          { ...route, page: page - 1 },
                          <>
                            <ArrowLeft size={17} />
                            {t("previousPage")}
                          </>,
                        )
                      ) : (
                        <span />
                      )}
                      <span>
                        {interpolate(t("pageOf"), {
                          page: integer(page),
                          pages: integer(pages),
                        })}
                      </span>
                      {page < pages ? (
                        link(
                          { ...route, page: page + 1 },
                          <>
                            {t("nextPage")}
                            <ArrowRight size={17} />
                          </>,
                        )
                      ) : (
                        <span />
                      )}
                    </nav>
                  )}
                </>
              )}
              {delayed && (
                <p className="inline-notice" role="status">
                  {p("updatesDelayed")}
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
