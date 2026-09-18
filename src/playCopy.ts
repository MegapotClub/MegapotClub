import en from "./retail-locales/en.json";
import { interpolate, type Locale } from "./i18n.ts";
const files = import.meta.glob("./retail-locales/*.json", {
  eager: true,
  import: "default",
}) as Record<string, typeof en>;
export const playCopy =
  (locale: Locale) =>
  (key: keyof typeof en, params?: Record<string, string | number>) =>
    interpolate((files[`./retail-locales/${locale}.json`] ?? en)[key], params);
