import { useState } from "react";
import type { PrinterStatus } from "@/shared/types";

type PrinterActionsProps = {
  printerIp: string | null;
  printerStatus: PrinterStatus;
  pendingPrinterPicker: string[] | null;
  onUpdated: () => void;
};

export function PrinterActions({
  printerIp,
  printerStatus,
  pendingPrinterPicker,
  onUpdated,
}: PrinterActionsProps) {
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
        setMessage(`Printer ${result.ip} is back online.`);
      } else {
        setError(
          result.ip
            ? `Printer ${result.ip} is still unreachable. Try rescan if the IP changed.`
            : "No printer IP saved.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reconnect failed");
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
        setError("No printers found on your network.");
        return;
      }

      if (printerIp && result.printers.includes(printerIp)) {
        setMessage(`Found saved printer at ${printerIp}.`);
        return;
      }

      setMessage(
        result.printers.length === 1
          ? `Found 1 printer at ${result.printers[0]}. Switch if your printer moved.`
          : `Found ${result.printers.length} printers. Saved IP ${printerIp ?? "none"} not in list.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
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
      setMessage(`Now using printer at ${ip}.`);
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not switch printer");
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleReconnect()}
          disabled={busy || !printerIp || printerStatus === "online"}
          className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
        >
          {reconnecting ? "Reconnecting..." : "Reconnect"}
        </button>
        <button
          type="button"
          onClick={() => void handleRescan()}
          disabled={busy}
          className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
        >
          {scanning ? "Scanning..." : "Rescan network"}
        </button>
      </div>

      {offline ? (
        <p className="text-xs text-zinc-500">
          Printer offline. Reconnect checks the saved IP. Rescan searches the local network.
        </p>
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
          Multiple printers detected after reconnect. Pick the correct one below.
        </p>
      ) : null}

      {showPicker ? (
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-zinc-500">
              {pendingPrinterPicker ? "Printers found — choose one" : "Other printers found"}
            </p>
            {pendingPrinterPicker ? (
              <button
                type="button"
                onClick={() => void handleDismissPicker()}
                className="text-xs text-zinc-500 transition hover:text-zinc-300"
              >
                Dismiss
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
                  {switchingIp === ip ? "Switching..." : "Use this IP"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
