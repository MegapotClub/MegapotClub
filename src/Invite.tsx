import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Gift,
  Share2,
  Coins,
  Trophy,
  LoaderCircle,
  Check,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Locale } from "./i18n.ts";
import { playCopy } from "./playCopy.ts";
import { errorCopy } from "./clubCopy.ts";
import { useWallet } from "./wallet.ts";
import { WalletButton } from "./WalletButton.tsx";
import { usePlayerAccount } from "./playerQuery.ts";
import { money } from "./model.ts";
import { shareLink } from "./RetailPrimitives.tsx";
import type { Route } from "./navigation.ts";
import { invitationUrl } from "./winShare.ts";
import { readReferralTerms, reviewAction, type Review } from "./native.ts";
import { ReviewCard } from "./ReviewCard.tsx";
import { useTransactions } from "./transactions.ts";

export function Invite({
  locale,
  urls,
}: {
  locale: Locale;
  urls: string[];
  navigate: (r: Route) => void;
}) {
  const p = playCopy(locale),
    w = useWallet(),
    q = usePlayerAccount(urls, w.account);
  const [notice, setNotice] = useState(""),
    [review, setReview] = useState<Review | null>(null),
    [busy, setBusy] = useState(false),
    [claimId, setClaimId] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const link = w.account ? invitationUrl(w.account) : "";
  const entries = useTransactions();
  const claim = entries.find(
    (e) =>
      e.id === claimId && e.account.toLowerCase() === w.account?.toLowerCase(),
  );
  const terms = useQuery({
    queryKey: ["referral-terms", urls],
    queryFn: ({ signal }) => readReferralTerms(urls, signal),
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.error ? 300_000 : 60_000),
    refetchIntervalInBackground: false,
    retry: false,
  });
  useEffect(() => {
    setNotice("");
    setReview(null);
    setBusy(false);
    setClaimId(null);
    request.current?.abort();
    request.current = null;
    return () => request.current?.abort();
  }, [w.account, w.revision]);
  const percent = (value: bigint) =>
    new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(Number(value) / 1e18);
  return (
    <section className="retail-page invite-page">
      <h1>{p("invite")}</h1>
      <div className="invite-lifetime">
        <strong>${new Intl.NumberFormat(locale).format(127555)}+</strong>
        <span>{p("lifetimeReferrals")}</span>
      </div>
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
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setNotice(p("copied"));
                } catch {
                  const input = document.getElementById("invite-link");
                  if (input instanceof HTMLInputElement) {
                    input.focus();
                    input.select();
                  }
                  setNotice(p("shareFailed"));
                }
              }}
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
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {w.account && q.data && q.data.referralEarnings > 0n && (
        <div className="referral-earned">
          <span>{p("referralEarned")}</span>
          <strong>
            ${money(q.data.referralEarnings.toString(), locale, 2)} USDC
          </strong>
          <button
            className="button button-primary"
            disabled={busy}
            onClick={async () => {
              if (!w.account || request.current) return;
              const controller = new AbortController();
              request.current = controller;
              setBusy(true);
              setNotice("");
              try {
                const next = await reviewAction(
                  urls,
                  w.account,
                  { kind: "referral" },
                  controller.signal,
                );
                if (!controller.signal.aborted) setReview(next);
              } catch (error) {
                if (!controller.signal.aborted)
                  setNotice(errorCopy(locale, error));
              } finally {
                if (request.current === controller) request.current = null;
                if (!controller.signal.aborted) setBusy(false);
              }
            }}
          >
            {busy ? (
              <>
                <LoaderCircle size={18} className="spinning" />
                {p("preparingClaim")}
              </>
            ) : (
              p("claim")
            )}
          </button>
        </div>
      )}
      {w.account && q.isError && <p role="status">{p("prizeReadError")}</p>}
      {review && review.account.toLowerCase() === w.account?.toLowerCase() && (
        <ReviewCard
          review={review}
          locale={locale}
          urls={urls}
          onClose={() => setReview(null)}
          onSent={(entry) => {
            setClaimId(entry.id);
            setReview(null);
          }}
        />
      )}
      {claim?.status === "confirmed" && (
        <p role="status">
          <Check size={18} />
          {p("claimComplete")}
        </p>
      )}
      <div className="invite-steps">
        <article>
          <Gift size={25} />
          <h3>{p("giftFriends")}</h3>
          <p>{p("giftFriendsDetail")}</p>
        </article>
        {terms.data && (
          <>
            <article>
              <Coins size={25} />
              <h3>{p("getPaidDaily")}</h3>
              <p>
                {p("getPaidDailyDetail", {
                  percent: percent(terms.data.purchaseFee),
                })}
              </p>
            </article>
            <article>
              <Trophy size={25} />
              <h3>{p("winIfTheyWin")}</h3>
              <p>
                {p("winIfTheyWinDetail", {
                  percent: percent(terms.data.winShare),
                  amount: `$${money(((terms.data.prizePool * terms.data.winShare) / 10n ** 18n).toString(), locale, 0)}`,
                })}
              </p>
            </article>
          </>
        )}
      </div>
    </section>
  );
}
