import { Trans, useTranslation } from "react-i18next";

export function WaitingPair() {
  const { t } = useTranslation();

  return (
    <section className="flex flex-1 flex-col justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="relative flex size-10 items-center justify-center rounded-full bg-primary/10">
          <span className="absolute size-10 animate-ping rounded-full bg-primary/20" />
          <span className="relative size-3 rounded-full bg-primary" />
        </div>
        <div>
          <h2 className="font-medium text-lg">{t("pairing.waiting")}</h2>
          <p className="text-primary text-sm">{t("pairing.listening")}</p>
        </div>
      </div>

      <ol className="space-y-3 text-sm leading-relaxed text-zinc-400">
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 font-medium text-xs text-zinc-300">
            1
          </span>
          <span>{t("pairing.step1")}</span>
        </li>
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 font-medium text-xs text-zinc-300">
            2
          </span>
          <span>
            <Trans i18nKey="pairing.step2" components={{ 1: <span className="text-zinc-200" /> }} />
          </span>
        </li>
      </ol>

      <p className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs text-zinc-500">
        {t("pairing.keepOpen")}
      </p>
    </section>
  );
}
