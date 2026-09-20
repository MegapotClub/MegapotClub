import { Modal } from "./Modal.tsx";
import { useDelayedStatus } from "./useDelayedStatus.ts";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ShieldCheck } from "lucide-react";
import type { Locale } from "./i18n.ts";
import { clubCopy, errorCopy } from "./clubCopy.ts";
import { money } from "./model.ts";
import { EXPLORER } from "./config.ts";
import { reviewAction, type Review } from "./native.ts";
import { useWallet } from "./wallet.ts";
import { submitReview, type Journal } from "./transactions.ts";

export function ReviewCard({
  review: initialReview,
  locale,
  urls,
  onClose,
  onSent,
}: {
  review: Review;
  locale: Locale;
  urls: string[];
  onClose: () => void;
  onSent: (entry: Journal) => void;
}) {
  const c = clubCopy(locale),
    wallet = useWallet(),
    revision = useRef(wallet.revision),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submission = useRef<AbortController | null>(null);
  useEffect(() => () => submission.current?.abort(), []);
  const claiming = ["claim", "referral"].includes(initialReview.action.kind);
  const queryClient = useQueryClient();
  const queryKey = [
    "claim-review",
    initialReview.account.toLowerCase(),
    initialReview.createdAt,
    wallet.revision,
    urls,
  ];
  const refreshed = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      reviewAction(urls, initialReview.account, initialReview.action, signal),
    initialData: initialReview,
    initialDataUpdatedAt: initialReview.createdAt,
    enabled:
      claiming &&
      !busy &&
      wallet.account?.toLowerCase() === initialReview.account.toLowerCase(),
    staleTime: 30_000,
    gcTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const review = claiming ? refreshed.data : initialReview;
  const call = review.calls[0];
  const matches =
    wallet.account?.toLowerCase() === review.account.toLowerCase() &&
    !review.position.contractWallet &&
    (claiming || wallet.revision === revision.current);
  const delayed = useDelayedStatus(refreshed.isError);
  const content = (
    <section
      className="review-card"
      aria-labelledby={claiming ? undefined : "review-title"}
      tabIndex={-1}
      ref={(el) => {
        if (!claiming && el && !el.dataset.focused) {
          el.dataset.focused = "true";
          el.focus();
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }}
    >
      {!claiming && (
        <>
          <div className="section-top">
            <div className="eyebrow">
              <ShieldCheck size={18} />
              {c("review")}
            </div>
            <button className="text-button" onClick={onClose} disabled={busy}>
              {c("close")}
            </button>
          </div>
          <h2 id="review-title">{c(call.kind)}</h2>
        </>
      )}
      <p className="review-amount">
        {claiming ? "$" : ""}
        {money(
          review.amount.toString(),
          locale,
          claiming && review.amount >= 10_000n ? 2 : 6,
        )}{" "}
        <small>USDC</small>
      </p>
      {call.kind === "approve" && (
        <p className="inline-notice">{c("approvalHelp")}</p>
      )}
      {review.action.kind === "deposit" && <p>{c("depositHelp")}</p>}
      {review.action.kind === "withdraw" && <p>{c("exitHelp")}</p>}
      {claiming && delayed && (
        <p className="inline-notice" role="status">
          {c("claimRefreshDelayed")}
        </p>
      )}
      <details className="call-inspector">
        <summary>{c("rawTransaction")}</summary>
        <p className="fine-print">{c("receive")}</p>
        <dl className="review-facts">
          <dt>{c("destination")}</dt>
          <dd>
            <a
              href={`${EXPLORER}/address/${call.to}`}
              target="_blank"
              rel="noreferrer"
            >
              <code>{call.to}</code>
            </a>
          </dd>
          <dt>Base · 8453</dt>
          <dd>#{review.block.toString()}</dd>
          <dt>{c("connected")}</dt>
          <dd>
            <code>{review.account}</code>
          </dd>
        </dl>
        <p className="fine-print">{c("noFee")}</p>
        <p>{c("exactCall")}:</p>
        <code>{call.data}</code>
        <p>value: 0 ETH · {review.calls.length} transaction(s)</p>
      </details>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="review-buttons">
        <button
          className="button button-primary"
          disabled={!matches || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            const controller = new AbortController();
            submission.current = controller;
            try {
              const sent = await submitReview(
                urls,
                review,
                claiming ? wallet.revision : revision.current,
                controller.signal,
                (fresh) => queryClient.setQueryData(queryKey, fresh),
              );
              if (!controller.signal.aborted) onSent(sent);
            } catch (e) {
              if (!controller.signal.aborted) setError(errorCopy(locale, e));
            } finally {
              if (!controller.signal.aborted) setBusy(false);
              if (submission.current === controller) submission.current = null;
            }
          }}
        >
          {busy ? c("working") : c("sign")}
          <ChevronRight size={18} />
        </button>
      </div>
      {!matches && (
        <p className="fine-print">
          {c(
            review.position.contractWallet ? "contractWallet" : "walletChanged",
          )}
        </p>
      )}
    </section>
  );
  return claiming ? (
    <Modal title={c(call.kind)} closeLabel={c("close")} onClose={onClose}>
      {content}
    </Modal>
  ) : (
    content
  );
}
