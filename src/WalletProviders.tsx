import {
  useEffect,
  useState,
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { WagmiContext } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RainbowKitProvider,
  darkTheme,
  lightTheme,
  type Locale as WalletLocale,
} from "@rainbow-me/rainbowkit";
import { walletConfig, restoreWalletConfig } from "./walletConfig.ts";
import type { Locale } from "./i18n.ts";
import { APP_NAME } from "./config.ts";
import { WalletAvatar } from "./WalletAvatar.tsx";
import "@rainbow-me/rainbowkit/styles.css";

const WalletReady = createContext(false);
export const useWalletReady = () => useContext(WalletReady);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 60_000, refetchOnWindowFocus: false },
  },
});
const locales: Record<Locale, WalletLocale> = {
  en: "en-US",
  es: "es-419",
  "pt-BR": "pt-BR",
  fr: "fr-FR",
  de: "de-DE",
  "zh-CN": "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
};
const options = {
  accentColor: "#2448ec",
  accentColorForeground: "#ffffff",
  borderRadius: "medium" as const,
  fontStack: "system" as const,
  overlayBlur: "small" as const,
};
const themes = {
  light: lightTheme(options),
  dark: darkTheme({
    ...options,
    accentColor: "#9bb6ff",
    accentColorForeground: "#101a34",
  }),
};
const subscribeTheme = (notify: () => void) => {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
};

/**
 * @cc [label:product] restore-authorized-wallet-session
 * Mount MUST let wagmi restore an already-authorized wallet session from its
 * persisted connector state. An explicit disconnect MUST remain respected.
 * Restoration MUST NOT submit a transaction or restore a signing review.
 */
export function WalletProviders({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void restoreWalletConfig(walletConfig)
      .catch(() => {
        // Failure leaves the library disconnected; manual connection remains available.
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.dataset.theme === "dark",
    () => false,
  );
  return (
    <WagmiContext.Provider value={walletConfig}>
      <WalletReady.Provider value={ready}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider
            avatar={WalletAvatar}
            locale={locales[locale]}
            theme={dark ? themes.dark : themes.light}
            modalSize="compact"
            appInfo={{ appName: APP_NAME }}
          >
            {children}
          </RainbowKitProvider>
        </QueryClientProvider>
      </WalletReady.Provider>
    </WagmiContext.Provider>
  );
}
