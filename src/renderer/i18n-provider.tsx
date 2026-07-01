import { type ReactNode, useEffect, useState } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { i18n, i18nResources, type Locale } from "@/shared/i18n";

type I18nProviderProps = {
  locale: Locale;
  children: ReactNode;
};

function I18nBootScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
      <span className="size-2 animate-pulse rounded-full bg-primary" />
    </main>
  );
}

let rendererPluginBound = false;

async function ensureRendererI18n(locale: Locale): Promise<void> {
  if (!rendererPluginBound) {
    i18n.use(initReactI18next);
    rendererPluginBound = true;
  }

  if (!i18n.isInitialized) {
    await i18n.init({
      resources: i18nResources,
      lng: locale,
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      react: {
        useSuspense: false,
      },
    });
    return;
  }

  await i18n.changeLanguage(locale);
}

export function I18nProvider({ locale, children }: I18nProviderProps) {
  const [ready, setReady] = useState(() => i18n.isInitialized);

  useEffect(() => {
    let cancelled = false;

    void ensureRendererI18n(locale).then(() => {
      if (cancelled) {
        return;
      }
      document.documentElement.lang = locale;
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (!ready) {
    return <I18nBootScreen />;
  }

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
