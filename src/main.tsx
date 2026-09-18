import { WalletProviders } from "./WalletProviders.tsx";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App.tsx";
import type { AppProps } from "./App.tsx";
import { LANGUAGES, type Locale } from "./i18n.ts";
import "./styles.css";

const pathLocale = location.pathname.split("/").filter(Boolean).at(-1);
const devLocale: Locale = LANGUAGES.some((l) => l.code === pathLocale)
  ? (pathLocale as Locale)
  : "en";
const localeFiles = import.meta.glob("./locales/*.json");
const initial = import.meta.env.DEV
  ? {
      locale: devLocale,
      messages: (
        (await localeFiles[`./locales/${devLocale}.json`]()) as {
          default: AppProps["messages"];
        }
      ).default,
      rootPath: pathLocale === devLocale ? "../" : "./",
    }
  : (JSON.parse(
      document.getElementById("initial-data")!.textContent!,
    ) as AppProps);
try {
  const saved = localStorage.getItem("megapot-club:locale");
  if (
    initial.rootPath === "./" &&
    saved &&
    ["en", "es", "pt-BR", "fr", "de", "zh-CN", "ja", "ko"].includes(saved) &&
    saved !== initial.locale
  )
    location.replace(
      `${initial.rootPath}${saved}/${location.search}${location.hash}`,
    );
} catch {
  /* Preferences are optional. */
}
if (import.meta.env.DEV)
  createRoot(document.getElementById("root")!).render(
    <WalletProviders locale={initial.locale}>
      <App {...initial} />
    </WalletProviders>,
  );
else
  hydrateRoot(
    document.getElementById("root")!,
    <WalletProviders locale={initial.locale}>
      <App {...initial} />
    </WalletProviders>,
  );
