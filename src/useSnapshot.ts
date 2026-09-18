import { useCallback, useEffect, useRef, useState } from "react";
import seed from "./snapshot.json";
import { DEFAULT_RPC_URLS, JACKPOT, SNAPSHOT_KEY } from "./config.ts";
import { parseRpcUrls, parseSnapshot, parseCachedSnapshot } from "./model.ts";
import type { Snapshot } from "./model.ts";

const initial = parseSnapshot(seed, JACKPOT);
if (!initial) throw new Error("The bundled snapshot is invalid");

export function useSnapshot(rootPath: string) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial!);
  const [urls, setUrls] = useState(DEFAULT_RPC_URLS);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [live, setLive] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const nextRefresh = useRef(0);
  const nextAutomatic = useRef(0);
  const attempt = useRef<AbortController | null>(null);
  // Browser cache is display-only; it never establishes the live block floor.
  const minimumBlock = useRef(BigInt(initial!.blockNumber));

  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      let configured = DEFAULT_RPC_URLS;
      try {
        const response = await fetch(`${rootPath}config.json`, {
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const config = await response.json();
          if (
            config.schema === 1 &&
            config.chainId === 8453 &&
            Array.isArray(config.rpcUrls)
          )
            configured = parseRpcUrls(config.rpcUrls);
        }
      } catch {
        /* The release defaults keep the static app usable. */
      }
      if (cancelled) return;
      try {
        const cached = parseCachedSnapshot(
          JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? "null"),
          JACKPOT,
          Date.now(),
        );
        if (
          cached &&
          cached.codeHash === initial!.codeHash &&
          BigInt(cached.blockNumber) > BigInt(initial!.blockNumber)
        )
          setSnapshot(cached);
        const preferences: unknown = JSON.parse(
          localStorage.getItem("megapot-club:rpc") ?? "null",
        );
        if (
          Array.isArray(preferences) &&
          preferences.every((x) => typeof x === "string")
        )
          configured = parseRpcUrls(preferences);
      } catch {
        /* Browser storage is optional. */
      }
      setUrls(configured);
      setReady(true);
    };
    void setup();
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const refresh = useCallback(async () => {
    if (busy.current || Date.now() < nextRefresh.current) return;
    nextRefresh.current = Date.now() + 5_000;
    nextAutomatic.current = Date.now() + 60_000;
    const controller = new AbortController();
    attempt.current = controller;
    busy.current = true;
    const run = generation.current;
    setLoading(true);
    try {
      const { fetchSnapshot } = await import("./chain.ts");
      const next = await fetchSnapshot(
        urls,
        initial!.codeHash,
        minimumBlock.current,
        controller.signal,
      );
      if (run !== generation.current) return;
      minimumBlock.current = BigInt(next.blockNumber);
      setSnapshot(next);
      setLive(true);
      setError(false);
      try {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(next));
      } catch {
        /* Quota/private browsing. */
      }
    } catch {
      if (run === generation.current) {
        nextRefresh.current = Date.now() + 30_000;
        setError(true);
      }
    } finally {
      if (run === generation.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [urls]);

  useEffect(() => {
    if (!ready) return;
    generation.current++;
    busy.current = false;
    nextRefresh.current = 0;
    minimumBlock.current = BigInt(initial!.blockNumber);
    setLive(false);
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden && Date.now() >= nextAutomatic.current)
        void refresh();
    }, 120_000);
    const onVisible = () => {
      if (!document.hidden && Date.now() >= nextAutomatic.current)
        void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      generation.current++;
      attempt.current?.abort();
      busy.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, refresh]);

  return { snapshot, urls, setUrls, refresh, loading, error, live };
}
