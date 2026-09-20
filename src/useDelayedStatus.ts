import { useEffect, useState } from "react";

/** Loading or a transient retry is not a connectivity incident. This changes
 * presentation only; live-read and transaction checks retain their own limits. */
export function useDelayedStatus(
  unavailable: boolean,
  identity = "",
  grace = 60_000,
) {
  const [elapsed, setElapsed] = useState<string | null>(null);
  useEffect(() => {
    setElapsed(null);
    if (!unavailable) return;
    const timer = setTimeout(() => setElapsed(identity), grace);
    return () => clearTimeout(timer);
  }, [unavailable, identity, grace]);
  return unavailable && elapsed === identity;
}
