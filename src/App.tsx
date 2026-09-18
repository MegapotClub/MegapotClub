import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  Globe2,
  History,
  Layers3,
  LockKeyhole,
  Settings2,
  Home,
  CreditCard,
  Gift,
  Menu,
  Sun,
  Moon,
  Monitor,
  ShieldCheck,
  Ticket,
  Asterisk,
} from "lucide-react";
import type { FormEvent } from "react";
import type { Locale, Messages } from "./i18n.ts";
import { LANGUAGES } from "./i18n.ts";
import { SUPPORT_DM_RECIPIENT, DEFAULT_RPC_URLS, APP_NAME } from "./config.ts";
import { money, parseRpcUrls } from "./model.ts";
import type { Draw } from "./model.ts";
import { useSnapshot } from "./useSnapshot.ts";
import { usePortalTools } from "./usePortalTools.ts";

import { normalNavigation, useRoute, type View } from "./navigation.ts";
import { useWallet } from "./wallet.ts";
import { WalletButton } from "./WalletButton.tsx";
import { Modal } from "./Modal.tsx";
import { errorCopy } from "./clubCopy.ts";
import { DrawTime } from "./drawTime.tsx";
import { About } from "./About.tsx";
import { Brand } from "./Brand.tsx";
import { SkipLink } from "./SkipLink.tsx";
const NativeWorkspace = lazy(() =>
  import("./NativeWorkspace.tsx").then((m) => ({ default: m.NativeWorkspace })),
);
const Tickets = lazy(() =>
  import("./Tickets.tsx").then((m) => ({ default: m.Tickets })),
);
type ModalName = "settings" | "result" | "profile" | "help" | null;
import { Results, ResultDetails } from "./Results.tsx";
import { TicketCollections } from "./TicketCollections.tsx";
import { RetailHome } from "./RetailHome.tsx";
import { Purchase } from "./Purchase.tsx";
import { Invite } from "./Invite.tsx";
const PlayerBalance = lazy(() =>
  import("./PlayerBalance.tsx").then((m) => ({ default: m.PlayerBalance })),
);
import { playCopy } from "./playCopy.ts";
import { usePlayerAccount, useReceiptRefresh } from "./playerQuery.ts";
import { RouteLink } from "./RetailPrimitives.tsx";

export type AppProps = { locale: Locale; messages: Messages; rootPath: string };

function Balls({
  numbers,
  bonus,
  small = false,
  labels,
}: {
  numbers?: number[];
  bonus?: number;
  small?: boolean;
  labels: [string, string];
}) {
  return (
    <div
      className={`balls ${small ? "small" : ""}`}
      role="group"
      aria-label={labels[0]}
    >
      {(numbers ?? Array(5).fill(null)).map((n, i) => (
        <span
          className={`ball ${n === null ? "blank" : ""}`}
          key={i}
          aria-label={n === null ? undefined : String(n)}
        >
          {n === null ? (
            <span aria-hidden="true">—</span>
          ) : (
            String(n).padStart(2, "0")
          )}
        </span>
      ))}
      <span className="ball-divider" aria-hidden="true">
        +
      </span>
      <span
        className={`ball bonus ${bonus === undefined ? "blank" : ""}`}
        aria-label={`${labels[1]} ${bonus ?? "—"}`}
      >
        {bonus === undefined ? (
          <Asterisk size={23} />
        ) : (
          String(bonus).padStart(2, "0")
        )}
      </span>
    </div>
  );
}

export default function App({ locale, messages: m, rootPath }: AppProps) {
  const { snapshot, urls, setUrls, error } = useSnapshot(rootPath);
  const { route, navigate: changeRoute } = useRoute();
  const view = route.view;
  const p = playCopy(locale);
  const wallet = useWallet();
  useReceiptRefresh();
  const viewLabel = (v: View) =>
    v === "draw"
      ? p("home")
      : v === "winnings"
        ? p("balance")
        : v === "invite"
          ? p("invite")
          : v === "play"
            ? p("play")
            : v === "tickets"
              ? p("tickets")
              : m.results;
  const player = usePlayerAccount(urls, wallet.account);
  const hasUnclaimed = Boolean(
    wallet.account &&
      player.data?.account.toLowerCase() === wallet.account.toLowerCase() &&
      player.data.prizeTotal > 0n &&
      !player.isError,
  );
  const [modal, setModal] = useState<ModalName>(null);
  const [selectedResult, setSelectedResult] = useState<{
    draw: Draw;
    blockNumber: string;
  } | null>(null);
  const [resultError, setResultError] = useState(false);
  const [now, setNow] = useState(snapshot.observedAt);
  const [rpcDraft, setRpcDraft] = useState(urls.join("\n"));
  const [configError, setConfigError] = useState(false);
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState("system");
  const [themeReady, setThemeReady] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const draw = snapshot.current;
  const recent = snapshot.recent;
  const stale = now - snapshot.blockTime * 1000 > 120_000 || error;
  const integer = (value: string) =>
    new Intl.NumberFormat(locale).format(BigInt(value));
  const labels: [string, string] = [m.winningNumbers, m.bonusNumber];

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    try {
      const saved = localStorage.getItem("megapot-club:theme");
      if (saved === "dark" || saved === "light") setTheme(saved);
    } catch {}
    setThemeReady(true);
    return () => {
      clearInterval(tick);
    };
  }, []);
  useEffect(() => {
    if (!themeReady) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme);
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem("megapot-club:theme", theme);
    } catch {}
    return () => media.removeEventListener("change", apply);
  }, [theme, themeReady]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (wallet.error) setToast(errorCopy(locale, wallet.error));
  }, [wallet.error, locale]);
  useEffect(() => {
    setRpcDraft(urls.join("\n"));
  }, [urls]);

  const navigate = (next: View) => {
    changeRoute({ view: next });
    setModal(null);
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() =>
      mainRef.current?.focus({ preventScroll: true }),
    );
  };
  usePortalTools(snapshot, navigate, stale);
  useEffect(() => {
    if (route.detail) setModal(route.detail);
    else if (view === "results" && route.draw) setModal("result");
    else setModal(null);
  }, [route.detail, view, route.draw]);
  useEffect(() => {
    if (!route.detail && view === "results" && route.draw) {
      setResultError(false);
      const found = [draw, ...recent].find((d) => d.id === route.draw);
      setSelectedResult(
        found ? { draw: found, blockNumber: snapshot.blockNumber } : null,
      );
      if (!found) {
        let stopped = false;
        void import("./chain.ts")
          .then(({ fetchDrawing }) =>
            fetchDrawing(urls, route.draw!, snapshot.codeHash),
          )
          .then((result) => {
            if (!stopped) setSelectedResult(result);
          })
          .catch(() => {
            if (!stopped) setResultError(true);
          });
        return () => {
          stopped = true;
        };
      }
    }
  }, [route.detail, route.draw, view, snapshot, urls]);
  const closeModal = () => {
    if (route.detail) changeRoute({ ...route, detail: undefined }, true);
    else if (view === "results" && route.draw)
      changeRoute({ view: "results" }, true);
    setModal(null);
  };
  const saveSettings = (e: FormEvent) => {
    e.preventDefault();
    setConfigError(false);
    try {
      const parsed = parseRpcUrls(
        rpcDraft
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean),
      );
      setUrls(parsed);
      try {
        localStorage.setItem("megapot-club:rpc", JSON.stringify(parsed));
      } catch {}
      setModal(null);
      changeRoute({ ...route, detail: undefined }, true);
      setToast(m.settingsSaved);
    } catch {
      setConfigError(true);
    }
  };

  return (
    <>
      <SkipLink label={m.skip} target={mainRef} />
      <header className="site-header">
        <a
          href="#draw"
          className="brand"
          onClick={(e) => {
            if (normalNavigation(e)) {
              e.preventDefault();
              navigate("draw");
            }
          }}
          aria-label={APP_NAME}
        >
          <Brand />
        </a>
        <nav className="desktop-nav" aria-label={APP_NAME}>
          {(["draw", "tickets", "winnings", "results", "invite"] as const).map(
            (v) => (
              <a
                key={v}
                href={`#${v}`}
                aria-current={view === v ? "page" : undefined}
                onClick={(e) => {
                  if (normalNavigation(e)) {
                    e.preventDefault();
                    navigate(v);
                  }
                }}
              >
                {viewLabel(v)}
                {v === "winnings" && hasUnclaimed && (
                  <span className="prize-dot" aria-label={p("unclaimed")} />
                )}
              </a>
            ),
          )}
        </nav>
        <div className="header-actions">
          <button
            className="menu-trigger icon-button"
            aria-label={p("menu")}
            aria-haspopup="dialog"
            aria-expanded={modal === "profile"}
            onClick={() => changeRoute({ ...route, detail: "profile" })}
          >
            <Menu size={23} />
          </button>
          <WalletButton locale={locale} header />
        </div>
      </header>
      <Suspense
        fallback={
          <main>
            <p role="status">{m.lookingUp}</p>
          </main>
        }
      >
        <main id="main" ref={mainRef} tabIndex={-1}>
          {view === "draw" && (
            <>
              <RetailHome
                snapshot={snapshot}
                locale={locale}
                navigate={changeRoute}
              />
              {(error || stale) && (
                <p className="inline-notice" role="status">
                  {p("updatesDelayed")}
                </p>
              )}
            </>
          )}
          {view === "play" && (
            <Purchase
              observedAt={snapshot.blockTime}
              stale={stale}
              draw={draw}
              locale={locale}
              route={route}
              navigate={changeRoute}
            />
          )}
          {view === "invite" && (
            <Invite locale={locale} urls={urls} navigate={changeRoute} />
          )}

          {view === "tickets" && !route.draw && (
            <TicketCollections
              locale={locale}
              urls={urls}
              snapshot={snapshot}
              route={route}
              navigate={changeRoute}
            />
          )}
          {view === "tickets" && route.draw && (
            <Tickets
              player={player.data}
              locale={locale}
              messages={m}
              urls={urls}
              snapshot={snapshot}
              route={route}
              navigate={changeRoute}
            />
          )}

          {view === "winnings" && (
            <PlayerBalance
              locale={locale}
              urls={urls}
              route={route}
              navigate={changeRoute}
            />
          )}

          {view === "results" && (
            <Results
              snapshot={snapshot}
              locale={locale}
              messages={m}
              navigate={changeRoute}
              stale={stale}
            />
          )}

          {view === "lp" && (
            <NativeWorkspace
              locale={locale}
              urls={urls}
              mode="lp"
              route={route}
              navigate={changeRoute}
            />
          )}
          {view === "about" && <About messages={m} />}
        </main>
      </Suspense>
      <footer className="footer">
        <div className="footer-brand">
          <Asterisk size={23} />
          <span>{m.footer}</span>
        </div>
        <div>
          <a
            href="#about"
            onClick={(e) => {
              if (normalNavigation(e)) {
                e.preventDefault();
                navigate("about");
              }
            }}
          >
            {m.about}
          </a>
          <label className="language-control">
            <Globe2 size={16} />
            <span className="sr-only">{m.language}</span>
            <select
              aria-label={m.language}
              value={locale}
              onChange={(e) => {
                try {
                  localStorage.setItem("megapot-club:locale", e.target.value);
                } catch {}
                location.assign(
                  `${rootPath}${e.target.value}/${location.search}${location.hash}`,
                );
              }}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </label>
        </div>
      </footer>
      <nav
        className={`mobile-nav ${view === "play" || (view === "tickets" && route.draw) ? "detail-nav-hidden" : ""}`}
        aria-label={APP_NAME}
      >
        {(
          [
            { view: "draw", icon: Home },
            { view: "tickets", icon: Ticket },
            { view: "winnings", icon: CreditCard },
            { view: "results", icon: History },
            { view: "invite", icon: Gift },
          ] as const
        ).map((item) => (
          <a
            key={item.view}
            href={`#${item.view}`}
            aria-current={view === item.view ? "page" : undefined}
            onClick={(e) => {
              if (normalNavigation(e)) {
                e.preventDefault();
                navigate(item.view);
              }
            }}
          >
            <item.icon size={20} />
            <span>
              {viewLabel(item.view)}
              {item.view === "winnings" && hasUnclaimed && (
                <span className="prize-dot" aria-label={p("unclaimed")} />
              )}
            </span>
          </a>
        ))}
      </nav>
      {modal && (
        <Modal
          title={
            modal === "profile"
              ? p("menu")
              : modal === "help"
                ? p("howToPlay")
                : modal === "settings"
                  ? m.settings
                  : m.resultTitle
          }
          closeLabel={m.close}
          onClose={closeModal}
          onBack={
            modal === "settings"
              ? () => changeRoute({ ...route, detail: "profile" })
              : undefined
          }
          backLabel={p("back")}
        >
          {modal === "profile" && (
            <div className="profile-menu">
              <div className="profile-theme">
                <span>{m.theme}</span>
                <div>
                  {(
                    [
                      { value: "light", icon: Sun },
                      { value: "dark", icon: Moon },
                      { value: "system", icon: Monitor },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.value}
                      aria-label={p(item.value)}
                      aria-pressed={theme === item.value}
                      onClick={() => setTheme(item.value)}
                    >
                      <item.icon size={19} />
                    </button>
                  ))}
                </div>
              </div>
              <RouteLink to={{ view: "lp" }} navigate={changeRoute}>
                <Layers3 size={20} />
                {p("liquidity")}
                <ArrowRight size={17} />
              </RouteLink>
              <button
                onClick={() => changeRoute({ ...route, detail: "settings" })}
              >
                <Settings2 size={20} />
                {m.settings}
                <ArrowRight size={17} />
              </button>
              <a
                href="https://docs.megapot.io/getting-started/provably-fair"
                target="_blank"
                rel="noreferrer"
              >
                <ShieldCheck size={20} />
                {p("fairness")}
                <ExternalLink size={16} />
              </a>
              <a
                href="https://docs.megapot.io/learn/audits"
                target="_blank"
                rel="noreferrer"
              >
                <LockKeyhole size={20} />
                {p("audits")}
                <ExternalLink size={16} />
              </a>
              <div className="profile-footer">
                {SUPPORT_DM_RECIPIENT ? (
                  <a
                    className="brand-support"
                    href={`https://x.com/messages/compose?recipient_id=${SUPPORT_DM_RECIPIENT}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Megapot Club ${p("support")}`}
                  >
                    <Brand compact />
                    <span>{p("support")}</span>
                  </a>
                ) : (
                  <button
                    className="brand-support"
                    onClick={() => setToast(p("supportPending"))}
                    aria-label={`Megapot Club ${p("support")}`}
                  >
                    <Brand compact />
                    <span>{p("support")}</span>
                  </button>
                )}
              </div>
            </div>
          )}
          {modal === "help" && (
            <>
              <p>{p("howToPlayDetail")}</p>
              <p>
                {p("pickHelp", { max: draw.ballMax, bonus: draw.bonusMax })}
              </p>
              <h3>{p("prizes")}</h3>
              <p>{p("prizesDetail")}</p>
            </>
          )}
          {modal === "settings" && (
            <form onSubmit={saveSettings}>
              <p>{m.rpcHelp}</p>
              <label htmlFor="rpc-urls">{m.rpcLabel}</label>
              <textarea
                id="rpc-urls"
                rows={4}
                value={rpcDraft}
                onChange={(e) => setRpcDraft(e.target.value)}
                spellCheck={false}
                required
              />
              <p className="fine-print">{m.rpcPrivacy}</p>
              {configError && (
                <p className="form-error" role="alert">
                  {m.rpcConfig}
                </p>
              )}
              <label htmlFor="theme">{m.theme}</label>
              <select
                id="theme"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
              >
                <option value="system">{m.system}</option>
                <option value="light">{m.light}</option>
                <option value="dark">{m.dark}</option>
              </select>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => {
                    setRpcDraft(DEFAULT_RPC_URLS.join("\n"));
                    setConfigError(false);
                  }}
                >
                  {m.resetSettings}
                </button>
                <button className="button button-primary" type="submit">
                  {m.saveSettings}
                </button>
              </div>
            </form>
          )}
          {modal === "result" && !selectedResult && (
            <p role="status">{resultError ? m.lookupFailed : m.lookingUp}</p>
          )}
          {modal === "result" && selectedResult && (
            <div className="result-detail">
              <span className="eyebrow">
                <DrawTime
                  timestamp={selectedResult.draw.closesAt}
                  locale={locale}
                />
              </span>
              <h3>{m.winningNumbers}</h3>
              {selectedResult.draw.result ? (
                <Balls
                  numbers={selectedResult.draw.result.numbers}
                  bonus={selectedResult.draw.result.bonus}
                  labels={labels}
                />
              ) : (
                <p>{m.resultPending}</p>
              )}
              <div className="result-metrics">
                <div>
                  <span>{m.prizePool}</span>
                  <strong>
                    {money(selectedResult.draw.prizePool, locale)} USDC
                  </strong>
                </div>
                <div>
                  <span>{m.entered}</span>
                  <strong>{integer(selectedResult.draw.ticketCount)}</strong>
                </div>
              </div>
              <ResultDetails
                draw={selectedResult.draw.id}
                locale={locale}
                route={route}
                navigate={changeRoute}
              />
              <div className="result-retail-actions">
                <RouteLink
                  className="button button-primary"
                  to={{ view: "play" }}
                  navigate={changeRoute}
                >
                  {p("playAgain")}
                  <ArrowRight size={18} />
                </RouteLink>
                <RouteLink
                  className="button button-outline"
                  to={{ view: "tickets", draw: selectedResult.draw.id }}
                  navigate={changeRoute}
                >
                  {p("viewTickets")}
                </RouteLink>
              </div>
            </div>
          )}
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </>
  );
}
