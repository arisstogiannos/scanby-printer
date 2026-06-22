import type { PrinterStatus } from "@/shared/types";

type VenueStatusProps = {
  businessName: string;
  printerIp: string | null;
  printerStatus: PrinterStatus;
  compact?: boolean;
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

export function VenueStatus({
  businessName,
  printerIp,
  printerStatus,
  compact = false,
}: VenueStatusProps) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 ${
        compact ? "px-3 py-2" : "p-4"
      }`}
    >
      <span className={`size-2.5 shrink-0 rounded-full ${statusDotClass(printerStatus)}`} />
      <div className="min-w-0 flex-1">
        <p className={`truncate font-medium ${compact ? "text-sm" : "text-base"} text-zinc-100`}>
          {businessName}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {printerIp ? (
            <>
              Printer {printerIp} · {STATUS_LABELS[printerStatus]}
            </>
          ) : (
            "No printer configured"
          )}
        </p>
      </div>
    </div>
  );
}
