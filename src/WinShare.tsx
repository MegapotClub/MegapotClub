import { useContext, useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Share2 } from "lucide-react";
import { Modal } from "./Modal.tsx";
import { playCopy } from "./playCopy.ts";
import {
  invitationUrl,
  sharePrizePool,
  winAmount,
  winCardSvg,
  xWinUrl,
  type ShareWin,
} from "./winShare.ts";
import { WinSharePrizePool } from "./winShareContext.ts";
import wordmark from "../brand/svg/megapot-club-logo-on-dark.svg?raw";
import clubIcon from "../brand/svg/megapot-club-icon-color.svg?raw";
import type { Locale } from "./i18n.ts";

/** Prepare the actual attachment before a click so native sharing retains user activation.
 * Target apps control caption handling; opening sharing never means a post was published. */
export function WinShare({ win, locale }: { win: ShareWin; locale: Locale }) {
  const p = playCopy(locale),
    prizePool = sharePrizePool(useContext(WinSharePrizePool), locale),
    [open, setOpen] = useState(false),
    [image, setImage] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(false),
    [notice, setNotice] = useState(""),
    [sharing, setSharing] = useState(false);
  const caption = `${p("winShareText", { amount: winAmount(win, locale) })}${prizePool ? ` ${p("winSharePrizePool", { prizePool })}` : ""} ${invitationUrl(win.account)}`;
  const svg = useMemo(
    () => winCardSvg(win, locale, p("youWon"), wordmark, clubIcon),
    [win.amount, win.account, win.date, locale],
  );
  useEffect(() => {
    if (!open) return;
    setError(false);
    setNotice("");
    setFile(null);
    setImage("");
    let active = true;
    const picture = new Image();
    picture.onload = () => {
      if (!active) return;
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 630;
      const context = canvas.getContext("2d");
      if (!context) {
        setError(true);
        return;
      }
      try {
        context.drawImage(picture, 0, 0);
        setImage(canvas.toDataURL("image/png"));
        canvas.toBlob((blob) => {
          if (!active) return;
          if (blob)
            setFile(
              new File([blob], "megapot-club-win.png", { type: "image/png" }),
            );
          else setError(true);
        }, "image/png");
      } catch {
        setError(true);
      }
    };
    picture.onerror = () => {
      if (active) setError(true);
    };
    picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    return () => {
      active = false;
    };
  }, [open, svg]);
  const canCopy =
    !!file &&
    typeof ClipboardItem !== "undefined" &&
    !!navigator.clipboard?.write;
  let canShare = false;
  try {
    canShare =
      !!file &&
      !!navigator.share &&
      !!navigator.canShare?.({ files: [file], text: caption });
  } catch {
    /* Unsupported attachment. */
  }
  return (
    <>
      <button
        className="button button-outline win-share-button"
        onClick={() => setOpen(true)}
      >
        <span className="x-mark" aria-hidden="true">
          𝕏
        </span>
        {p("shareOnX")}
      </button>
      {open && (
        <Modal
          title={p("shareYourWin")}
          closeLabel={p("close")}
          onClose={() => setOpen(false)}
        >
          <div className="win-share-preview">
            {image ? (
              <img
                src={image}
                width="1200"
                height="630"
                alt={`${p("youWon")} ${winAmount(win, locale)} · MegapotClub.eth.limo`}
              />
            ) : (
              <p role="status">
                {error ? p("imageFailed") : p("preparingImage")}
              </p>
            )}
            <div className="win-share-actions">
              <button
                className="button button-outline"
                disabled={!canCopy || sharing}
                onClick={async () => {
                  if (!file) return;
                  setNotice("");
                  try {
                    await navigator.clipboard.write([
                      new ClipboardItem({ "image/png": file }),
                    ]);
                    setNotice(p("imageCopied"));
                  } catch {
                    setNotice(p("imageCopyFailed"));
                  }
                }}
              >
                <Copy size={18} />
                {p("copyImage")}
              </button>
              <button
                className="button button-primary"
                disabled={!canShare || sharing}
                onClick={async () => {
                  if (!file) return;
                  setNotice("");
                  setSharing(true);
                  try {
                    await navigator.share({ files: [file], text: caption });
                  } catch (e) {
                    if (!(e instanceof DOMException && e.name === "AbortError"))
                      setNotice(p("imageShareFailed"));
                  } finally {
                    setSharing(false);
                  }
                }}
              >
                <Share2 size={18} />
                {p("shareImage")}
              </button>
            </div>
            <p className="fine-print">
              {file
                ? canShare
                  ? p("chooseX")
                  : canCopy
                    ? p("pasteIntoX")
                    : p("imageSharingUnavailable")
                : p("preparingImage")}
            </p>
            <div className="win-share-caption">
              <p>{caption}</p>
              <button
                className="icon-button"
                aria-label={p("copyPostText")}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(caption);
                    setNotice(p("postTextCopied"));
                  } catch {
                    setNotice(p("selectPostText"));
                  }
                }}
              >
                <Copy size={18} />
              </button>
            </div>
            <a
              className="text-button"
              href={xWinUrl(
                win,
                caption.replace(` ${invitationUrl(win.account)}`, ""),
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              {p("openX")}
              <ExternalLink size={15} />
            </a>
            {notice && (
              <p role="status" className="fine-print">
                {notice}
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
