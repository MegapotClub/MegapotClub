import { useQuery } from "@tanstack/react-query";
import { playCopy } from "./playCopy.ts";
import { DrawTime } from "./drawTime.tsx";
import { ArrowDownToLine } from "lucide-react";
import type { Locale } from "./i18n.ts";
import { clubCopy, errorCopy } from "./clubCopy.ts";
import { readNativeHistory } from "./native.ts";
import { downloadJSON } from "./transactions.ts";
import { formatReturn } from "./historyMath.ts";
export function NativeHistory({
  locale,
  urls,
}: {
  locale: Locale;
  urls: string[];
}) {
  const c = clubCopy(locale);
  const query = useQuery({
    queryKey: ["native-history", urls],
    queryFn: () => readNativeHistory(urls),
    staleTime: 300_000,
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const history = query.data,
    error = query.error ? errorCopy(locale, query.error) : "";
  return (
    <section className="action-card">
      <div className="section-top">
        <h2>{c("nativeHistory")}</h2>
      </div>
      <p>{c("nativeHistoryHelp")}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {history && (
        <>
          <div className="history-table">
            <table>
              <thead>
                <tr>
                  <th>{playCopy(locale)("drawTime")}</th>
                  <th>{c("nativeNet")}</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((row) => (
                  <tr key={row.draw.toString()}>
                    <td>
                      <DrawTime timestamp={row.scheduledAt} locale={locale} />
                    </td>
                    <td
                      className={
                        row.netReturnPpm !== null && row.netReturnPpm < 0n
                          ? "negative-return"
                          : ""
                      }
                    >
                      {formatReturn(row.netReturnPpm, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="text-button passport-button"
            onClick={() =>
              downloadJSON("megapot-native-draw-history.json", {
                schema: 1,
                scope:
                  "native LP accumulator changes; excludes wrapper, Aave, bridging and personal execution costs",
                ...history,
              })
            }
          >
            <ArrowDownToLine size={17} />
            {c("export")}
          </button>
        </>
      )}
    </section>
  );
}
