import { Asterisk } from "lucide-react";

/** Shared lockup; partner-ready outlined masters live in brand/. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`brand-lockup${compact ? " brand-compact" : ""}`}
      aria-hidden="true"
    >
      {!compact && (
        <span className="brand-symbol">
          <Asterisk strokeWidth={3.2} />
        </span>
      )}
      <span className="brand-words">
        Megapot<span className="brand-club">CLUB</span>
      </span>
    </span>
  );
}
