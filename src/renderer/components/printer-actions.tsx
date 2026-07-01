import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Locale, PrinterScanSnapshot, PrinterStatus } from "@/shared/types";
import { translateError } from "../translate-error";
import { useFormatDate } from "../use-format-date";

type PrinterActionsProps = {
  printerIp: string | null;
  printerStatus: PrinterStatus;
  pendingPrinterPicker: string[] | null;
  lastScan: PrinterScanSnapshot | null;
  locale: Locale;
  onUpdated: () => void;
};

export function PrinterActions({
  printerIp,
  printerStatus,
  pendingPrinterPicker,
  lastScan,
  locale,
  onUpdated,
}: PrinterActionsProps) {
  const { t } = useTranslation();
  const { formatTimeOnly } = useFormatDate(locale);
  const [reconnecting, setReconnecting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [switchingIp, setSwitchingIp] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [foundPrinters, setFoundPrinters] = useState<string[]>([]);

  const offline = printerStatus === "offline";
  const busy = printerStatus === "scanning" || reconnecting || scanning;

  async function handleReconnect() {
    setReconnecting(true);
    setError(null);
    setMessage(null);
    setFoundPrinters([]);

    try {
      const result = await window.scanbyPrint.reconnectPrinter();
      onUpdated();

      if (result.online) {
        setMessage(t("printer.backOnline", { ip: result.ip }));
      } else {
        setError(
          result.ip ? t("printer.stillUnreachable", { ip: result.ip }) : t("printer.noIpSaved"),
        );
      }
    } catch (e) {
      setError(translateError(e, t) || t("errors.reconnectFailed"));
    } finally {
      setReconnecting(false);
    }
  }

  async function handleRescan() {
    setScanning(true);
    setError(null);
    setMessage(null);
    setFoundPrinters([]);

    try {
      const result = await window.scanbyPrint.scanPrinters();
      setFoundPrinters(result.printers);
      onUpdated();

      if (result.printers.length === 0) {
        setError(t("printer.noPrintersOnNetwork"));
        return;
      }

      if (printerIp && result.printers.includes(printerIp)) {
        setMessage(t("printer.foundSavedPrinter", { ip: printerIp }));
        return;
      }

      setMessage(
        result.printers.length === 1
          ? t("printer.foundOneSwitch", { ip: result.printers[0] })
          : t("printer.foundManyNotInList", {
              count: result.printers.length,
              savedIp: printerIp ?? t("printer.noSavedIp"),
            }),
      );
    } catch (e) {
      setError(translateError(e, t) || t("errors.scanFailed"));
    } finally {
      setScanning(false);
    }
  }

  async function handleSwitchIp(ip: string) {
    setSwitchingIp(ip);
    setError(null);
    setMessage(null);

    try {
      await window.scanbyPrint.switchPrinterIp(ip);
      setFoundPrinters([]);
      await window.scanbyPrint.clearPendingPrinterPicker();
      setMessage(t("printer.nowUsing", { ip }));
      onUpdated();
    } catch (e) {
      setError(translateError(e, t) || t("errors.switchPrinterFailed"));
    } finally {
      setSwitchingIp(null);
    }
  }

  const alternatePrinters = foundPrinters.filter((ip) => ip !== printerIp);
  const pickerPrinters = pendingPrinterPicker ?? alternatePrinters;
  const showPicker = pickerPrinters.length > 0;

  async function handleDismissPicker() {
    await window.scanbyPrint.clearPendingPrinterPicker();
    onUpdated();
  }

  function formatLastScanLine(): string | null {
    if (!lastScan || printerStatus === "scanning" || scanning) {
      return null;
    }

    const time = formatTimeOnly(lastScan.completedAt);
    const subnetPart = lastScan.subnet
      ? t("printer.lastScanSubnet", { subnet: lastScan.subnet })
      : "";
    const foundPart =
      lastScan.printers.length === 0
        ? t("printer.lastScanNone")
        : t("printer.lastScanCount", { count: lastScan.printers.length });

    return t("printer.lastScan", { time, subnet: subnetPart, found: foundPart });
  }

  const lastScanLine = formatLastScanLine();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleReconnect()}
          disabled={busy || !printerIp || printerStatus === "online"}
          className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
        >
          {reconnecting ? t("printer.reconnecting") : t("printer.reconnect")}
        </button>
        <button
          type="button"
          onClick={() => void handleRescan()}
          disabled={busy}
          className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
        >
          {scanning ? t("printer.scanning") : t("printer.rescanNetwork")}
        </button>
      </div>

      {offline ? <p className="text-xs text-zinc-500">{t("printer.offlineHint")}</p> : null}

      {lastScanLine ? <p className="text-xs text-zinc-500">{lastScanLine}</p> : null}

      {printerStatus === "scanning" && !scanning ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2">
          <span className="size-2 animate-pulse rounded-full bg-amber-400" />
          <p className="text-amber-200 text-sm">{t("printer.autoScanning")}</p>
        </div>
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

      {pendingPrinterPicker && pendingPrinterPicker.length > 1 ? (
        <p className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-amber-200 text-sm">
          {t("printer.multipleAfterReconnect")}
        </p>
      ) : null}

      {showPicker ? (
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-zinc-500">
              {pendingPrinterPicker
                ? t("printer.printersChooseOne")
                : t("printer.otherPrintersFound")}
            </p>
            {pendingPrinterPicker ? (
              <button
                type="button"
                onClick={() => void handleDismissPicker()}
                className="text-xs text-zinc-500 transition hover:text-zinc-300"
              >
                {t("printer.dismiss")}
              </button>
            ) : null}
          </div>
          <ul className="space-y-2">
            {pickerPrinters.map((ip) => (
              <li key={ip} className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm text-zinc-200">{ip}</span>
                <button
                  type="button"
                  onClick={() => void handleSwitchIp(ip)}
                  disabled={switchingIp !== null}
                  className="shrink-0 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-primary text-xs transition hover:bg-primary/20 disabled:opacity-50"
                >
                  {switchingIp === ip ? t("printer.switching") : t("printer.useThisIp")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
