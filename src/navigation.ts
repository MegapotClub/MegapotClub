import { useEffect, useRef, useState } from "react";

export const VIEWS = [
  "draw",
  "tickets",
  "winnings",
  "results",
  "play",
  "invite",
  "about",
  "lp",
] as const;
export type View = (typeof VIEWS)[number];
export type LPView =
  | "position"
  | "activity"
  | "details"
  | "vaults"
  | "recovery";
export type Route = {
  view: View;
  draw?: string;
  address?: string;
  page?: number;
  period?: "past";
  ticket?: string;
  resultTab?: "prizes";
  ref?: string;
  checkout?: boolean;
  choose?: boolean;
  section?: "prizes" | "refunds" | "activity";
  tab?: LPView;
  product?: "base-usdc" | "base-eth" | "l1-usdc" | "l1-eth";
  detail?: "settings" | "profile" | "help";
  vaultView?: "deposit" | "redeem" | "requests" | "activity" | "manage";
  request?: string;
  requestKind?: "deposit" | "exit";
};
export const HOME_ROUTE: Route = { view: "draw" };
const TABS = ["position", "activity", "details", "vaults", "recovery"];
const PRODUCTS = ["base-usdc", "base-eth", "l1-usdc", "l1-eth"];

/**
 * @cc [label:security] navigation-is-data
 * URL state MUST be bounded, allowlisted display data. It MUST NOT encode executable calls,
 * authorization, RPC credentials, or trigger a wallet prompt during restoration.
 */
export function parseRoute(hash: string): Route {
  const text = hash.replace(/^#\/?/, "").slice(0, 1500);
  const [path, query = ""] = text.split("?", 2);
  const [name, deep] = path.split("/");
  const params = new URLSearchParams(query);
  const view =
    name === "plans"
      ? "play"
      : VIEWS.includes(name as View)
        ? (name as View)
        : "draw";
  const route: Route = { view };
  if (view === "results" && params.get("resultTab") === "prizes")
    route.resultTab = "prizes";
  const ref = params.get("ref");
  if (view === "play" && ref && /^0x[0-9a-fA-F]{40}$/.test(ref))
    route.ref = ref;
  if (view === "play" && params.get("checkout") === "1") route.checkout = true;
  if (view === "play" && params.get("choose") === "1") route.choose = true;
  const draw = params.get("draw") ?? (view === "results" ? deep : undefined);
  if (draw && /^[1-9]\d{0,17}$/.test(draw)) route.draw = draw;
  const address = params.get("address");
  if (address && /^0x[0-9a-fA-F]{40}$/.test(address)) route.address = address;
  const page = params.get("page");
  if (view === "tickets" && page && /^[1-9]\d{0,5}$/.test(page))
    route.page = Number(page);
  if (view === "tickets" && !route.draw && params.get("period") === "past")
    route.period = "past";
  const ticket = params.get("ticket");
  if (
    view === "winnings" &&
    ticket &&
    /^[1-9]\d{0,77}$/.test(ticket) &&
    BigInt(ticket) < 2n ** 256n
  )
    route.ticket = ticket;
  const tab = params.get("tab");
  const section = params.get("section");
  if (
    view === "winnings" &&
    section &&
    ["prizes", "refunds", "activity"].includes(section)
  )
    route.section = section as Route["section"];
  if (view === "lp" && tab && TABS.includes(tab)) route.tab = tab as LPView;
  const product = params.get("product");
  if (view === "lp" && product && PRODUCTS.includes(product))
    route.product = product as Route["product"];
  const detail = params.get("detail");
  if (detail && ["settings", "profile", "help"].includes(detail))
    route.detail = detail as Route["detail"];
  if (view === "lp" && route.tab === "vaults") {
    const sub = params.get("vaultView"),
      id = params.get("request"),
      kind = params.get("requestKind");
    if (
      sub &&
      ["deposit", "redeem", "requests", "activity", "manage"].includes(sub)
    )
      route.vaultView = sub as Route["vaultView"];
    if (id && /^[1-9]\d{0,77}$/.test(id) && BigInt(id) < 2n ** 256n)
      route.request = id;
    if (kind === "deposit" || kind === "exit") route.requestKind = kind;
  }
  return route;
}

export function routeHref(route: Route): string {
  const params = new URLSearchParams();
  if (route.resultTab) params.set("resultTab", route.resultTab);
  if (route.ref) params.set("ref", route.ref);
  if (route.checkout) params.set("checkout", "1");
  if (route.choose) params.set("choose", "1");
  if (route.draw) params.set("draw", route.draw);
  if (route.address) params.set("address", route.address);
  if (route.page && route.page > 1) params.set("page", String(route.page));
  if (route.period) params.set("period", route.period);
  if (route.ticket) params.set("ticket", route.ticket);
  if (route.section && route.section !== "prizes")
    params.set("section", route.section);
  if (route.tab && route.tab !== "position") params.set("tab", route.tab);
  if (route.product && route.product !== "base-usdc")
    params.set("product", route.product);
  if (route.detail) params.set("detail", route.detail);
  if (route.vaultView && route.vaultView !== "deposit")
    params.set("vaultView", route.vaultView);
  if (route.request) params.set("request", route.request);
  if (route.requestKind && route.requestKind !== "deposit")
    params.set("requestKind", route.requestKind);
  const query = params.toString();
  return `#${route.view}${query ? `?${query}` : ""}`;
}

export function normalNavigation(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function useRoute() {
  // Match prerendered HTML; restore deep state before any account-dependent actions.
  const [route, setRoute] = useState<Route>(HOME_ROUTE);
  const restoring = useRef(false);
  const pending = useRef<{ hash: string; y: number; focus: boolean } | null>(
    null,
  );
  const saveScroll = () => {
    if (!restoring.current)
      history.replaceState(
        { ...history.state, clubScrollY: window.scrollY },
        "",
      );
  };
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const restore = () => {
      const next = parseRoute(location.hash);
      const saved: unknown = history.state?.clubScrollY;
      restoring.current = true;
      pending.current = {
        hash: routeHref(next),
        y:
          typeof saved === "number" &&
          Number.isFinite(saved) &&
          saved >= 0 &&
          saved < 10_000_000
            ? saved
            : 0,
        focus: !next.detail && !(next.view === "results" && next.draw),
      };
      setRoute(next);
    };
    let frame = 0;
    const record = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(saveScroll);
    };
    restore();
    window.addEventListener("hashchange", restore);
    window.addEventListener("popstate", restore);
    window.addEventListener("scroll", record, { passive: true });
    window.addEventListener("pagehide", saveScroll);
    return () => {
      cancelAnimationFrame(frame);
      history.scrollRestoration = previous;
      window.removeEventListener("hashchange", restore);
      window.removeEventListener("popstate", restore);
      window.removeEventListener("scroll", record);
      window.removeEventListener("pagehide", saveScroll);
    };
  }, []);
  useEffect(() => {
    const target = pending.current;
    if (!target || target.hash !== routeHref(route)) return;
    pending.current = null;
    restoring.current = true;
    // Lazy workspaces may not have their final height on the first commit.
    // Restore once content fits; user input always takes priority over restoration.
    let done = false;
    const finish = () => {
      done = true;
      restoring.current = false;
      observer.disconnect();
    };
    const apply = () => {
      if (done) return;
      window.scrollTo({ top: target.y, behavior: "instant" });
      if (Math.abs(window.scrollY - target.y) < 2) finish();
    };
    const observer = new ResizeObserver(apply);
    observer.observe(document.body);
    if (target.focus)
      document.getElementById("main")?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(apply);
    const timeout = setTimeout(finish, 2000);
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    events.forEach((event) =>
      window.addEventListener(event, finish, { passive: true, once: true }),
    );
    return () => {
      finish();
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      events.forEach((event) => window.removeEventListener(event, finish));
    };
  }, [route]);
  function navigate(next: Route, replace = false) {
    const canonical = parseRoute(routeHref(next));
    const hash = routeHref(canonical);
    saveScroll();
    if (hash !== location.hash) {
      if (replace) history.replaceState(history.state, "", hash);
      else
        history.pushState(
          {
            club: true,
            clubScrollY: next.view === route.view ? window.scrollY : 0,
          },
          "",
          hash,
        );
    }
    setRoute(canonical);
  }
  return { route, navigate };
}
