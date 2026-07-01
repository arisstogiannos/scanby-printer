import { type MouseEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Locale,
  PrintHistoryEntry,
  PrintHistorySource,
  PrintHistoryStatus,
} from "@/shared/types";
import { translateError } from "../translate-error";
import { useFormatDate } from "../use-format-date";

type PrintHistoryProps = {
  entries: PrintHistoryEntry[];
  locale: Locale;
  onRetry?: () => void;
};

type PayloadField = {
  label: string;
  value: string;
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

function PayloadDetails({ entry, locale }: { entry: PrintHistoryEntry; locale: Locale }) {
  const { t } = useTranslation();
  const { formatDateTime } = useFormatDate(locale);

  const sourceLabels: Record<PrintHistorySource, string> = useMemo(
    () => ({
      realtime: t("history.sourceAuto"),
      manual: t("history.sourceManual"),
      test: t("history.sourceTest"),
    }),
    [t],
  );

  const statusLabels: Record<PrintHistoryStatus, string> = useMemo(
    () => ({
      received: t("history.statusReceived"),
      printed: t("history.statusPrinted"),
      failed: t("history.statusFailed"),
    }),
    [t],
  );

  const fields: PayloadField[] = [];

  if (entry.payload) {
    const order = entry.payload;
    fields.push({ label: t("history.orderId"), value: order.id });
    fields.push({ label: t("history.orderNumber"), value: String(order.number) });
    fields.push({ label: t("history.tableLabel"), value: order.table });
    fields.push({ label: t("history.created"), value: formatDateTime(order.createdAt) });
  } else {
    fields.push({ label: t("history.orderId"), value: entry.orderId });
    fields.push({ label: t("history.orderNumber"), value: String(entry.orderNumber) });
    fields.push({ label: t("history.tableLabel"), value: entry.table });
  }

  fields.push({ label: t("history.source"), value: sourceLabels[entry.source] });
  fields.push({ label: t("history.status"), value: statusLabels[entry.status] });

  if (entry.error) {
    fields.push({ label: t("history.error"), value: entry.error });
  }

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
            {t("history.items")}
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
                {item.notes ? (
                  <p className="mt-1 text-zinc-500">{t("history.notes", { notes: item.notes })}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function PrintHistory({ entries, locale, onRetry }: PrintHistoryProps) {
  const { t } = useTranslation();
  const { formatTime } = useFormatDate(locale);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const sourceLabels: Record<PrintHistorySource, string> = useMemo(
    () => ({
      realtime: t("history.sourceAuto"),
      manual: t("history.sourceManual"),
      test: t("history.sourceTest"),
    }),
    [t],
  );

  const statusLabels: Record<PrintHistoryStatus, string> = useMemo(
    () => ({
      received: t("history.statusReceived"),
      printed: t("history.statusPrinted"),
      failed: t("history.statusFailed"),
    }),
    [t],
  );

  function toggleEntry(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  function formatOrderLabel(entry: PrintHistoryEntry): string {
    if (entry.source === "test") {
      return t("history.testPrint");
    }
    return `#${entry.orderNumber}`;
  }

  async function handleRetry(entry: PrintHistoryEntry, event: MouseEvent) {
    event.stopPropagation();
    setRetryingId(entry.id);
    setRetryError(null);

    try {
      const result = await window.scanbyPrint.retryPrint(entry.id);
      if (!result.ok) {
        setRetryError(t("history.retrySkipped"));
      }
      onRetry?.();
    } catch (e) {
      setRetryError(translateError(e, t) || t("errors.retryFailed"));
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-medium text-sm text-zinc-200">{t("history.title")}</h2>
        <span className="text-xs text-zinc-500">
          {t("history.recentCount", { count: entries.length })}
        </span>
      </div>

      {retryError ? (
        <p className="mb-3 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-red-400 text-sm">
          {retryError}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <p className="rounded-lg border border-zinc-800/80 border-dashed px-4 py-8 text-center text-sm text-zinc-500">
          {t("history.empty")}
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
                    aria-label={statusLabels[entry.status]}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm text-zinc-100">
                        {formatOrderLabel(entry)}
                      </span>
                      {entry.source !== "test" ? (
                        <span className="truncate text-xs text-zinc-500">
                          {t("history.table", { table: entry.table })}
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full border px-2 py-0.5 font-medium text-[10px] uppercase tracking-wide ${statusBadgeClass(entry.status)}`}
                      >
                        {statusLabels[entry.status]}
                      </span>
                    </div>
                    {entry.status === "failed" && entry.error && !expanded ? (
                      <p className="mt-0.5 truncate text-red-400 text-xs">{entry.error}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {entry.status === "failed" && entry.payload ? (
                      <button
                        type="button"
                        onClick={(event) => void handleRetry(entry, event)}
                        disabled={retryingId === entry.id}
                        className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-primary text-xs transition hover:bg-primary/20 disabled:opacity-50"
                      >
                        {retryingId === entry.id ? "..." : t("history.retry")}
                      </button>
                    ) : null}
                    <div className="text-right">
                      <p className="text-xs text-zinc-400">{formatTime(entry.printedAt)}</p>
                      <p className="text-[10px] text-zinc-600 uppercase tracking-wide">
                        {sourceLabels[entry.source]}
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
                      {t("history.details")}
                    </p>
                    <PayloadDetails entry={entry} locale={locale} />
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
