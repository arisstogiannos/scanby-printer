import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DOWNLOAD_PAGE_URL } from "@/shared/constants";
import type { Locale, UpdateState } from "@/shared/types";
import { translateError } from "../translate-error";
import { useFormatDate } from "../use-format-date";

type SettingsPanelProps = {
  update: UpdateState;
  locale: Locale;
  onUpdated: () => void;
};

export function SettingsPanel({ update, locale, onUpdated }: SettingsPanelProps) {
  const { t } = useTranslation();
  const { formatLastChecked } = useFormatDate(locale);
  const [checking, setChecking] = useState(false);
  const [changingLocale, setChangingLocale] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckForUpdates() {
    setChecking(true);
    setError(null);
    setMessage(null);

    try {
      const next = await window.scanbyPrint.checkForUpdates();
      onUpdated();

      if (next.isStoreBuild) {
        setMessage(t("settings.storeUpdates"));
        return;
      }

      if (next.status === "ready" && next.version) {
        setMessage(t("settings.updateReady", { version: next.version }));
        return;
      }

      if (next.status === "downloading") {
        setMessage(
          next.version
            ? t("settings.updateDownloading", { version: next.version })
            : t("settings.updateInProgress"),
        );
        return;
      }

      if (next.status === "checking") {
        return;
      }

      if (next.status === "error") {
        setError(next.error ?? t("errors.updateCheckFailed"));
        return;
      }

      setMessage(t("settings.latestVersion"));
    } catch (e) {
      setError(translateError(e, t) || t("errors.updateCheckFailed"));
    } finally {
      setChecking(false);
    }
  }

  async function handleLocaleChange(nextLocale: Locale) {
    if (nextLocale === locale || changingLocale) {
      return;
    }

    setChangingLocale(true);
    setError(null);

    try {
      await window.scanbyPrint.setLocale(nextLocale);
      onUpdated();
    } catch (e) {
      setError(translateError(e, t) || t("errors.unknown"));
    } finally {
      setChangingLocale(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div>
        <h2 className="font-medium text-sm text-zinc-200">{t("settings.title")}</h2>
        <p className="mt-0.5 text-xs text-zinc-500">{t("settings.subtitle")}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-zinc-500">{t("settings.language")}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleLocaleChange("en")}
            disabled={changingLocale}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition disabled:opacity-50 ${
              locale === "en"
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-zinc-700 bg-zinc-800/80 hover:border-zinc-600"
            }`}
          >
            {t("settings.languageEn")}
          </button>
          <button
            type="button"
            onClick={() => void handleLocaleChange("el")}
            disabled={changingLocale}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition disabled:opacity-50 ${
              locale === "el"
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-zinc-700 bg-zinc-800/80 hover:border-zinc-600"
            }`}
          >
            {t("settings.languageEl")}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleCheckForUpdates()}
          disabled={checking}
          className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
        >
          {checking ? t("settings.checking") : t("settings.checkForUpdates")}
        </button>
        <span className="text-xs text-zinc-500">
          {t("settings.lastChecked", {
            time: formatLastChecked(update.lastCheckedAt, t("settings.never")),
          })}
        </span>
      </div>

      {update.isStoreBuild ? (
        <p className="text-sm text-zinc-400">
          {t("settings.storeBuild")}{" "}
          <a
            href={DOWNLOAD_PAGE_URL}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            {t("settings.downloadGithub")}
          </a>
        </p>
      ) : null}

      {message ? (
        <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-primary text-sm">
          {message}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-red-400 text-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}
