import i18next from "i18next";
import el from "./locales/el.json";
import en from "./locales/en.json";

export type Locale = "en" | "el";

export const i18n = i18next.createInstance();

export const i18nResources = {
  en: { translation: en },
  el: { translation: el },
};

export async function initI18n(locale: Locale): Promise<void> {
  if (!i18n.isInitialized) {
    await i18n.init({
      resources: i18nResources,
      lng: locale,
      fallbackLng: "en",
      interpolation: { escapeValue: false },
    });
    return;
  }

  await i18n.changeLanguage(locale);
}

export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

export function getActiveLocale(): Locale {
  return i18n.language === "el" ? "el" : "en";
}

export function localeTag(locale: Locale): string {
  return locale === "el" ? "el-GR" : "en-GB";
}
