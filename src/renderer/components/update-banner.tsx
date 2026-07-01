import { Trans, useTranslation } from "react-i18next";
import type { UpdateState } from "@/shared/types";

type UpdateBannerProps = {
  update: UpdateState;
  onInstall: () => void;
  installing: boolean;
  hidden?: boolean;
};

export function UpdateBanner({ update, onInstall, installing, hidden }: UpdateBannerProps) {
  const { t } = useTranslation();

  if (hidden || update.status !== "ready" || !update.version) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-sky-900/50 bg-sky-950/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sky-200 text-sm">
        <Trans
          i18nKey="update.ready"
          values={{ version: update.version }}
          components={{ 1: <span className="font-medium" /> }}
        />
      </p>
      <button
        type="button"
        onClick={onInstall}
        disabled={installing || update.isStoreBuild}
        className="shrink-0 rounded-lg bg-sky-600 px-3 py-2 font-medium text-sm text-white transition hover:bg-sky-500 disabled:opacity-50"
      >
        {installing ? t("update.restarting") : t("update.restartToInstall")}
      </button>
    </div>
  );
}
