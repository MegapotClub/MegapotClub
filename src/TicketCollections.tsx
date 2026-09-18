import { Identity } from "./Identity.tsx";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Plus, Ticket } from "lucide-react";
import { useWallet } from "./wallet.ts";
import { usePlayerAccount } from "./playerQuery.ts";
import { WalletButton } from "./WalletButton.tsx";
import { fetchTicketCollections } from "./chain.ts";
import type { Locale } from "./i18n.ts";
import type { Route } from "./navigation.ts";
import type { Snapshot } from "./model.ts";
import { playCopy } from "./playCopy.ts";
import { RouteLink, PaperTicket } from "./RetailPrimitives.tsx";
import { DrawTime } from "./drawTime.tsx";
export function TicketCollections({
  locale,
  urls,
  snapshot,
  route,
  navigate,
}: {
  locale: Locale;
  urls: string[];
  snapshot: Snapshot;
  route: Route;
  navigate: (r: Route) => void;
}) {
  const p = playCopy(locale),
    w = useWallet(),
    account = route.address ?? w.account,
    query = usePlayerAccount(urls, account),
    data = query.data;
  const current = data?.currentDraw ?? BigInt(snapshot.current.id),
    page = Math.min(
      route.page ?? 1,
      Math.max(1, Math.ceil((Number(current) - 1) / 6)),
    ),
    olderIds = Array.from(
      { length: 6 },
      (_, i) => current - BigInt((page - 1) * 6 + i + 1),
    )
      .filter((id) => id > 0n)
      .map(String);
  const older = useQuery({
    queryKey: ["ticket-archive", urls, account?.toLowerCase(), olderIds],
    enabled: Boolean(account) && page > 1 && olderIds.length > 0,
    queryFn: ({ signal }) =>
      fetchTicketCollections(urls, account!, olderIds, signal),
    staleTime: 300_000,
    refetchInterval: (q) => (q.state.error ? 600_000 : 300_000),
    refetchIntervalInBackground: false,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const collections =
    page === 1
      ? data?.draws.map((d) => ({
          id: String(d.id),
          time: Number(d.state.drawingTime),
          tickets: d.tickets.map((t) => ({
            numbers: [...t.normals],
            bonus: t.bonusball,
          })),
          count: d.tickets.length,
        }))
      : older.data?.map((d) => ({
          id: d.drawId,
          time: d.draw.closesAt,
          tickets: d.tickets,
          count: d.total,
        }));
  const selectedQuery = page === 1 ? query : older;
  const card = (d: NonNullable<typeof collections>[number]) => (
    <RouteLink
      key={d.id}
      to={{ view: "tickets", draw: d.id, address: route.address }}
      navigate={navigate}
      className={`ticket-collection-card ${d.count ? "owned" : ""}`}
    >
      {d.count > 0 ? (
        <PaperTicket
          numbers={d.tickets[0].numbers}
          bonus={d.tickets[0].bonus}
          locale={locale}
          count={d.count}
        />
      ) : (
        <div className="empty-paper">
          <Ticket size={36} />
        </div>
      )}
      <div className="collection-caption">
        {d.count === 0 && <strong>{p("ticketTotal", { count: 0 })}</strong>}
        <DrawTime timestamp={d.time} locale={locale} />
      </div>
    </RouteLink>
  );
  return (
    <section className="retail-page ticket-overview">
      <div className="section-top">
        <h1>{p("tickets")}</h1>
        <RouteLink
          to={{ view: "play" }}
          navigate={navigate}
          className="button button-primary"
        >
          <Plus size={18} />
          {p("addTickets")}
        </RouteLink>
      </div>
      {!account ? (
        <div className="ticket-welcome">
          <Ticket size={42} />
          <h2>{p("noTickets")}</h2>
          <p>{p("noTicketsDetail")}</p>
          <WalletButton locale={locale} />
        </div>
      ) : (
        <>
          <div className="collection-status">
            <span>
              <Identity address={account} />
            </span>
          </div>
          {selectedQuery.isError && (
            <p className="inline-notice" role="alert">
              {p("prizeReadError")}
            </p>
          )}
          {!collections && selectedQuery.isPending && (
            <p role="status">{p("checkingPrizes")}</p>
          )}
          {page === 1 && collections?.[0] && (
            <>
              <h2>{p("upcoming")}</h2>
              {card(collections[0])}
            </>
          )}
          {collections?.some(
            (d) => d.id !== current.toString() && d.count > 0,
          ) && <h2 className="previous-collection-heading">{p("previous")}</h2>}
          <div className="past-collection-grid">
            {collections
              ?.filter((d) => d.id !== current.toString() && d.count > 0)
              .map(card)}
          </div>
          {collections && (
            <nav className="ticket-pagination">
              {page > 1 ? (
                <RouteLink
                  to={{ ...route, page: page - 1 }}
                  navigate={navigate}
                >
                  <ArrowLeft size={17} />
                  {p("back")}
                </RouteLink>
              ) : (
                <span />
              )}
              {olderIds.length > 0 && olderIds.at(-1) !== "1" && (
                <RouteLink
                  to={{ ...route, page: page + 1 }}
                  navigate={navigate}
                >
                  {p("older")}
                  <ArrowRight size={17} />
                </RouteLink>
              )}
            </nav>
          )}
        </>
      )}
    </section>
  );
}
