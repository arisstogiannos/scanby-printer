import { useTranslation } from "react-i18next";

type BusinessCardProps = {
  businessId: string | null;
  businessName: string;
};

export function BusinessCard({ businessId, businessName }: BusinessCardProps) {
  const { t } = useTranslation();

  return (
    <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div>
        <h2 className="font-medium text-sm text-zinc-200">{t("business.title")}</h2>
        <p className="mt-0.5 text-xs text-zinc-500">{t("business.subtitle")}</p>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <span className="size-2.5 shrink-0 rounded-full bg-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-base text-zinc-100">{businessName}</p>
          <p className="mt-0.5 text-xs text-primary">{t("business.linkedReceiving")}</p>
        </div>
      </div>
      {businessId ? (
        <button
          type="button"
          className="w-full rounded-lg bg-primary/10 px-4 py-2 text-sm text-primary hover:bg-primary/20"
          onClick={() => {
            window.open(`https://app.scanby.cloud/${businessId}`, "_blank", "noopener,noreferrer");
          }}
        >
          {t("business.openDashboard")}
        </button>
      ) : null}
    </section>
  );
}
