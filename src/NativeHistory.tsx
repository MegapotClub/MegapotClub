import { useState } from "react";
import { ArrowDownToLine, RefreshCw } from "lucide-react";
import type { Locale } from "./i18n.ts";
import { clubCopy, errorCopy } from "./clubCopy.ts";
import { readNativeHistory, type NativeHistory as History } from "./native.ts";
import { downloadJSON } from "./transactions.ts";
import { formatReturn } from "./historyMath.ts";
export function NativeHistory({
  locale,
  urls,
}: {
  locale: Locale;
  urls: string[];
}) {
  const c = clubCopy(locale),
    [history, setHistory] = useState<History | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="action-card">
      <div className="section-top">
        <h2>{c("nativeHistory")}</h2>
        <button
          className="button button-outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              setHistory(await readNativeHistory(urls));
            } catch (e) {
              setError(errorCopy(locale, e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={17} className={busy ? "spinning" : ""} />
          {busy ? c("working") : c("refresh")}
        </button>
      </div>
      <p>{c("nativeHistoryHelp")}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {history && (
        <>
          <p className="fine-print">Base · #{history.block.toString()}</p>
          <div className="history-table">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>UTC</th>
                  <th>{c("nativeNet")}</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((row) => (
                  <tr key={row.draw.toString()}>
                    <td>{row.draw.toString()}</td>
                    <td>
                      {new Date(row.scheduledAt * 1000).toLocaleDateString(
                        locale,
                        { timeZone: "UTC" },
                      )}
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
