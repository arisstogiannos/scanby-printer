import { Trans, useTranslation } from "react-i18next";

type UpdatePromptProps = {
  version: string;
  onInstall: () => void;
  onLater: () => void;
  installing: boolean;
  isStoreBuild: boolean;
};

export function UpdatePrompt({
  version,
  onInstall,
  onLater,
  installing,
  isStoreBuild,
}: UpdatePromptProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-sky-900/50 bg-zinc-900 p-5 shadow-xl">
        <div>
          <p className="font-medium text-sky-300">{t("updatePrompt.title")}</p>
          <p className="mt-2 text-sm text-zinc-300">
            <Trans
              i18nKey="updatePrompt.body"
              values={{ version }}
              components={{ 1: <span className="font-medium text-sky-200" /> }}
            />
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onInstall}
            disabled={installing || isStoreBuild}
            className="flex-1 rounded-lg bg-sky-600 px-4 py-2.5 font-medium text-sm text-white transition hover:bg-sky-500 disabled:opacity-50"
          >
            {installing ? t("update.restarting") : t("update.restartToInstall")}
          </button>
          <button
            type="button"
            onClick={onLater}
            disabled={installing}
            className="flex-1 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
          >
            {t("updatePrompt.later")}
          </button>
        </div>
      </div>
    </div>
  );
}
