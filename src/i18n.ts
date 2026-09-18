import type en from "./locales/en.json";
export type Messages = typeof en;
export type Locale =
  | "en"
  | "es"
  | "pt-BR"
  | "fr"
  | "de"
  | "zh-CN"
  | "ja"
  | "ko";
export const LANGUAGES: { code: Locale; name: string }[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "pt-BR", name: "Português" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "zh-CN", name: "简体中文" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
];
export const interpolate = (
  value: string,
  params: Record<string, string | number> = {},
) =>
  value.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(params[key] ?? `{${key}}`),
  );
