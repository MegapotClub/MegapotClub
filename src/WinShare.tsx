import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { Modal } from "./Modal.tsx";
import { playCopy } from "./playCopy.ts";
import { winAmount, winCardSvg, xWinUrl, type ShareWin } from "./winShare.ts";
import type { Locale } from "./i18n.ts";

/** Win sharing only opens an X composer. It never posts, signs, or invokes generic sharing. */
export function WinShare({ win, locale }: { win: ShareWin; locale: Locale }) {
  const p = playCopy(locale),
    [open, setOpen] = useState(false),
    [image, setImage] = useState(""),
    [error, setError] = useState(false);
  const svg = useMemo(
    () => winCardSvg(win, locale, p("youWon")),
    [win.amount, win.account, win.date, locale],
  );
  useEffect(() => {
    if (!open) return;
    setError(false);
    let active = true;
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const picture = new Image();
    picture.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 630;
      const context = canvas.getContext("2d");
      if (!context) {
        setError(true);
        return;
      }
      context.drawImage(picture, 0, 0);
      if (active) setImage(canvas.toDataURL("image/png"));
    };
    picture.onerror = () => {
      if (active) setError(true);
    };
    picture.src = url;
    return () => {
      active = false;
      setImage("");
    };
  }, [open, svg]);
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
                alt={`${p("youWon")} ${winAmount(win, locale)}`}
              />
            ) : (
              <p role="status">
                {error ? p("shareFailed") : p("preparingImage")}
              </p>
            )}
            <p>{p("attachWinImage")}</p>
            <div className="win-share-actions">
              {image && (
                <a
                  className="button button-outline"
                  href={image}
                  download="megapot-club-win.png"
                >
                  <Download size={18} />
                  {p("saveImage")}
                </a>
              )}
              <a
                className="button button-primary"
                href={xWinUrl(
                  win,
                  p("winShareText", { amount: winAmount(win, locale) }),
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                {p("shareOnX")}
                <ExternalLink size={17} />
              </a>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
