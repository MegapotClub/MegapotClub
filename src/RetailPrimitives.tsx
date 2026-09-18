import type { ReactNode } from "react";
import { normalNavigation, routeHref, type Route } from "./navigation.ts";
import { playCopy } from "./playCopy.ts";
import type { Locale } from "./i18n.ts";
export function RouteLink({
  to,
  navigate,
  children,
  className = "",
  label,
}: {
  to: Route;
  navigate: (r: Route) => void;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <a
      href={routeHref(to)}
      className={className}
      aria-label={label}
      onClick={(e) => {
        if (normalNavigation(e)) {
          e.preventDefault();
          navigate(to);
        }
      }}
    >
      {children}
    </a>
  );
}
export function NumberBalls({
  numbers,
  bonus,
  small = false,
}: {
  numbers: number[];
  bonus: number;
  small?: boolean;
}) {
  return (
    <div
      className={`retail-balls ${small ? "small" : ""}`}
      aria-label={`${numbers.join(", ")} + ${bonus}`}
    >
      {numbers.map((n, i) => (
        <span key={i}>{n || "—"}</span>
      ))}
      <span className="retail-bonus">{bonus}</span>
    </div>
  );
}
/** Functional ticket representation: values are actual selected/owned numbers, not a stock illustration. */
export function PaperTicket({
  numbers,
  bonus,
  locale,
  count,
}: {
  numbers: number[];
  bonus: number | null;
  locale: Locale;
  count?: number;
}) {
  const p = playCopy(locale);
  return (
    <div className="paper-stack">
      <div className="paper-ticket">
        <div className="paper-values">
          {count !== undefined && (
            <strong className="paper-ticket-count">
              {p(count === 1 ? "ticketTotalOne" : "ticketTotal", {
                count: count.toLocaleString(locale),
              })}
            </strong>
          )}
          <div className="paper-labels">
            <span>{p("numbersLabel")}</span>
            <span>{p("bonus")}</span>
          </div>
          <div className="paper-numbers">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i}>{numbers[i] ?? "—"}</span>
            ))}
            <b>{bonus ?? "—"}</b>
          </div>
        </div>
        <div className="paper-brand">
          MEGAPOT <strong>CLUB</strong>
        </div>
      </div>
    </div>
  );
}
export async function shareLink(
  url: string,
  title: string,
  text?: string,
): Promise<"shared" | "copied" | "cancelled"> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ url, title, text });
      return "shared";
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return "cancelled";
    }
  }
  await navigator.clipboard.writeText(url);
  return "copied";
}
