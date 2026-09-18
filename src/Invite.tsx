import { useEffect, useState } from "react";
import { Copy, Gift, Share2, ArrowRight } from "lucide-react";
import type { Locale } from "./i18n.ts";
import { playCopy } from "./playCopy.ts";
import { useWallet } from "./wallet.ts";
import { WalletButton } from "./WalletButton.tsx";
import { usePlayerAccount } from "./playerQuery.ts";
import { money } from "./model.ts";
import { RouteLink, shareLink } from "./RetailPrimitives.tsx";
import type { Route } from "./navigation.ts";
export function Invite({
  locale,
  urls,
  navigate,
}: {
  locale: Locale;
  urls: string[];
  navigate: (r: Route) => void;
}) {
  const p = playCopy(locale),
    w = useWallet(),
    q = usePlayerAccount(urls, w.account),
    [link, setLink] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const url = new URL(location.href);
    url.hash = w.account ? `#play?ref=${w.account}` : "#draw";
    setLink(url.href);
    setNotice("");
  }, [w.account]);
  return (
    <section className="retail-page invite-page">
      <h1>{p("invite")}</h1>
      <div className="invite-art" aria-hidden="true">
        <Gift size={68} strokeWidth={1.3} />
      </div>
      <h2>{p("inviteHeading")}</h2>
      <p className="page-description">{p("inviteDetail")}</p>
      {!w.account ? (
        <div className="invite-connect">
          <p>{p("inviteNoWallet")}</p>
          <WalletButton locale={locale} />
        </div>
      ) : (
        <>
          <label className="invite-link-label" htmlFor="invite-link">
            {p("inviteLink")}
          </label>
          <div className="invite-link-field">
            <input id="invite-link" value={link} readOnly />
            <button
              className="icon-button"
              aria-label={p("copy")}
              onClick={() =>
                void navigator.clipboard
                  .writeText(link)
                  .then(() => setNotice(p("copied")))
                  .catch(() => setNotice(p("shareFailed")))
              }
            >
              <Copy size={20} />
            </button>
          </div>
          <button
            className="button button-primary full-width"
            onClick={() =>
              void shareLink(link, p("shareTitle"))
                .then((result) => {
                  if (result === "copied") setNotice(p("copied"));
                })
                .catch(() => setNotice(p("shareFailed")))
            }
          >
            <Share2 size={20} />
            {p("share")}
          </button>
          <p className="fine-print">{p("referralPending")}</p>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {w.account && (!q.data || q.isError || q.data.referralEarnings > 0n) && (
        <div className="referral-earned">
          <span>{p("referralEarned")}</span>
          <strong>
            {q.data
              ? `${money(q.data.referralEarnings.toString(), locale, 2)} USDC`
              : "—"}
          </strong>
          {q.isError && <p className="inline-notice">{p("prizeReadError")}</p>}
          <RouteLink
            to={{ view: "winnings" }}
            navigate={navigate}
            className="text-button"
          >
            {p("balance")}
            <ArrowRight size={17} />
          </RouteLink>
        </div>
      )}
    </section>
  );
}
