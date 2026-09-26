import { useTranslation } from "react-i18next";
import type { PrinterRole, PrinterRuntimeInfo, PrinterStatus } from "@/shared/types";

type RegisteredPrintersProps = {
  printers: PrinterRuntimeInfo[];
  unroutableFiscalCount: number;
};

function statusDotClass(status: PrinterStatus): string {
  switch (status) {
    case "online":
      return "bg-primary";
    case "printing":
      return "animate-pulse bg-primary";
    case "scanning":
      return "animate-pulse bg-amber-400";
    default:
      return "bg-zinc-600";
  }
}

/**
 * The registry as this station sees it.
 *
 * Shown in the agent's own window because this is where someone looks when a
 * receipt did not come out. A venue with no fiscal printer gets told so here,
 * next to the documents waiting on one, rather than having to work it out from
 * an empty paper tray.
 */
export function RegisteredPrinters({ printers, unroutableFiscalCount }: RegisteredPrintersProps) {
  const { t } = useTranslation();

  if (printers.length === 0) {
    return null;
  }

  const roleLabels: Record<PrinterRole, string> = {
    KITCHEN: t("printers.roleKitchen"),
    FISCAL: t("printers.roleFiscal"),
    ALL: t("printers.roleAll"),
  };

  const statusLabels: Record<PrinterStatus, string> = {
    online: t("status.online"),
    offline: t("status.offline"),
    printing: t("status.printing"),
    scanning: t("status.scanning"),
  };

  const hasFiscalPrinter = printers.some(
    (printer) => printer.enabled && (printer.role === "FISCAL" || printer.role === "ALL"),
  );

  return (
    <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div>
        <h2 className="font-medium text-sm text-zinc-200">{t("printers.title")}</h2>
        <p className="mt-0.5 text-xs text-zinc-500">{t("printers.subtitle")}</p>
      </div>

      <ul className="space-y-2">
        {printers.map((printer) => (
          <li
            key={printer.id}
            className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
          >
            <span className={`size-2.5 shrink-0 rounded-full ${statusDotClass(printer.status)}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-zinc-100">{printer.name}</p>
              <p className="mt-0.5 font-mono text-xs text-zinc-500">{printer.address}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs text-zinc-300">{roleLabels[printer.role]}</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {printer.enabled ? statusLabels[printer.status] : t("printers.disabled")}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {!hasFiscalPrinter ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300 text-xs">
          {t("printers.noFiscalWarning")}
        </p>
      ) : null}

      {unroutableFiscalCount > 0 ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-xs">
          {t("printers.waitingDocuments", { count: unroutableFiscalCount })}
        </p>
      ) : null}
    </section>
  );
}
