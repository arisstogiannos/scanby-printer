import type { PrinterScanSnapshot, PrinterStatus } from "@/shared/types";
import { PrinterActions } from "./printer-actions";

type PrinterCardProps = {
  printerIp: string | null;
  printerStatus: PrinterStatus;
  pendingPrinterPicker: string[] | null;
  lastScan: PrinterScanSnapshot | null;
  onUpdated: () => void;
};

const STATUS_LABELS: Record<PrinterStatus, string> = {
  online: "Online",
  offline: "Offline",
  printing: "Printing",
  scanning: "Scanning",
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

export function PrinterCard({
  printerIp,
  printerStatus,
  pendingPrinterPicker,
  lastScan,
  onUpdated,
}: PrinterCardProps) {
  return (
    <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div>
        <h2 className="font-medium text-sm text-zinc-200">Printer</h2>
        <p className="mt-0.5 text-xs text-zinc-500">Network receipt printer</p>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <span className={`size-2.5 shrink-0 rounded-full ${statusDotClass(printerStatus)}`} />
        <div className="min-w-0 flex-1">
          {printerIp ? (
            <>
              <p className="font-mono text-sm text-zinc-100">{printerIp}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{STATUS_LABELS[printerStatus]}</p>
            </>
          ) : (
            <p className="text-sm text-zinc-400">No printer configured</p>
          )}
        </div>
      </div>

      <PrinterActions
        printerIp={printerIp}
        printerStatus={printerStatus}
        pendingPrinterPicker={pendingPrinterPicker}
        lastScan={lastScan}
        onUpdated={onUpdated}
      />
    </section>
  );
}
