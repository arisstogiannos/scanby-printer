import { useState } from "react";
import type { PrintHistoryEntry, PrintHistorySource, PrintHistoryStatus } from "@/shared/types";

type PrintHistoryProps = {
  entries: PrintHistoryEntry[];
};

type PayloadField = {
  label: string;
  value: string;
};

const SOURCE_LABELS: Record<PrintHistorySource, string> = {
  realtime: "Auto",
  manual: "Manual",
  test: "Test",
};

const STATUS_LABELS: Record<PrintHistoryStatus, string> = {
  received: "Received",
  printed: "Printed",
  failed: "Failed",
};

function statusBadgeClass(status: PrintHistoryStatus): string {
  switch (status) {
    case "printed":
      return "border-primary/30 bg-primary/10 text-primary";
    case "failed":
      return "border-red-500/30 bg-red-500/10 text-red-400";
    default:
      return "border-amber-500/30 bg-amber-500/10 text-amber-400";
  }
}

function statusDotClass(status: PrintHistoryStatus): string {
  switch (status) {
    case "printed":
      return "bg-primary";
    case "failed":
      return "bg-red-400";
    default:
      return "bg-amber-400";
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatOrderLabel(entry: PrintHistoryEntry): string {
  if (entry.source === "test") {
    return "Test print";
  }
  return `#${entry.orderNumber}`;
}

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
}

function buildPayloadFields(entry: PrintHistoryEntry): PayloadField[] {
  const fields: PayloadField[] = [];

  if (entry.payload) {
    const order = entry.payload;
    fields.push({ label: "Order ID", value: order.id });
    fields.push({ label: "Order number", value: String(order.number) });
    fields.push({ label: "Table", value: order.table });
    fields.push({ label: "Created", value: formatCreatedAt(order.createdAt) });
  } else {
    fields.push({ label: "Order ID", value: entry.orderId });
    fields.push({ label: "Order number", value: String(entry.orderNumber) });
    fields.push({ label: "Table", value: entry.table });
  }

  fields.push({ label: "Source", value: SOURCE_LABELS[entry.source] });
  fields.push({ label: "Status", value: STATUS_LABELS[entry.status] });

  if (entry.error) {
    fields.push({ label: "Error", value: entry.error });
  }

  return fields;
}

function PayloadDetails({ entry }: { entry: PrintHistoryEntry }) {
  const fields = buildPayloadFields(entry);
  const items = entry.payload?.items ?? [];

  return (
    <div className="max-h-48 space-y-3 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3">
      <dl className="space-y-2">
        {fields.map((field) => (
          <div
            key={field.label}
            className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-0.5 text-xs"
          >
            <dt className="text-zinc-500">{field.label}</dt>
            <dd className="text-zinc-200">{field.value}</dd>
          </div>
        ))}
      </dl>

      {items.length > 0 ? (
        <div>
          <p className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wide">
            Items
          </p>
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={`${item.quantity}-${item.name}-${item.notes ?? ""}`}
                className="rounded-md border border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-xs"
              >
                <p className="text-zinc-200">
                  {item.quantity}× {item.name}
                </p>
                {item.notes ? <p className="mt-1 text-zinc-500">Notes: {item.notes}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function PrintHistory({ entries }: PrintHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleEntry(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-medium text-sm text-zinc-200">Print history</h2>
        <span className="text-xs text-zinc-500">{entries.length} / 10 recent</span>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-zinc-800/80 border-dashed px-4 py-8 text-center text-sm text-zinc-500">
          No prints yet. Orders from your venue will appear here.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => {
            const expanded = expandedId === entry.id;

            return (
              <li
                key={entry.id}
                className={`rounded-lg border bg-zinc-950/40 transition-colors ${
                  expanded ? "border-primary/30" : "border-zinc-800/80"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleEntry(entry.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-zinc-900/60"
                  aria-expanded={expanded}
                >
                  <span
                    role="img"
                    className={`size-2 shrink-0 rounded-full ${statusDotClass(entry.status)}`}
                    aria-label={STATUS_LABELS[entry.status]}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm text-zinc-100">
                        {formatOrderLabel(entry)}
                      </span>
                      {entry.source !== "test" ? (
                        <span className="truncate text-xs text-zinc-500">Table {entry.table}</span>
                      ) : null}
                      <span
                        className={`rounded-full border px-2 py-0.5 font-medium text-[10px] uppercase tracking-wide ${statusBadgeClass(entry.status)}`}
                      >
                        {STATUS_LABELS[entry.status]}
                      </span>
                    </div>
                    {entry.status === "failed" && entry.error && !expanded ? (
                      <p className="mt-0.5 truncate text-red-400 text-xs">{entry.error}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="text-right">
                      <p className="text-xs text-zinc-400">{formatTime(entry.printedAt)}</p>
                      <p className="text-[10px] text-zinc-600 uppercase tracking-wide">
                        {SOURCE_LABELS[entry.source]}
                      </p>
                    </div>
                    <span
                      className={`text-zinc-500 text-xs transition-transform ${expanded ? "rotate-180" : ""}`}
                      aria-hidden
                    >
                      ▾
                    </span>
                  </div>
                </button>

                {expanded ? (
                  <div className="border-zinc-800/80 border-t px-3 py-3">
                    <p className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wide">
                      Details
                    </p>
                    <PayloadDetails entry={entry} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
