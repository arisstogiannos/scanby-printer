import { useCallback, useEffect, useRef, useState } from "react";
import { AUTO_SAVE_CANCEL_MS } from "@/shared/constants";
import type { PrinterScanSnapshot, PrinterStatus } from "@/shared/types";

type PrinterSetupProps = {
  businessName: string;
  printerStatus: PrinterStatus;
  pendingPrinterPicker: string[] | null;
  lastScan: PrinterScanSnapshot | null;
  onSaved: () => void;
  onUnpaired: () => void;
};

type SelectionMode = "scanned" | "manual";

export function PrinterSetup({
  businessName,
  printerStatus,
  pendingPrinterPicker,
  lastScan,
  onSaved,
  onUnpaired,
}: PrinterSetupProps) {
  const [printers, setPrinters] = useState<string[]>([]);
  const [subnet, setSubnet] = useState<string | null>(null);
  const [selectedIp, setSelectedIp] = useState("");
  const [manualIp, setManualIp] = useState("");
  const [mode, setMode] = useState<SelectionMode>("scanned");
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [autoSaveCountdown, setAutoSaveCountdown] = useState<number | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoPipelineIpRef = useRef<string | null>(null);

  const activeIp = mode === "manual" ? manualIp.trim() : selectedIp;
  const isScanning = scanning;
  const isExternalScan = printerStatus === "scanning" && !scanning;
  const scanBusy = isScanning || isExternalScan;

  const clearAutoSaveTimer = useCallback((): void => {
    if (autoSaveTimerRef.current) {
      clearInterval(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    setAutoSaveCountdown(null);
  }, []);

  const runSmartPipeline = useCallback(
    async (ip: string) => {
      if (autoPipelineIpRef.current === ip) {
        return;
      }
      autoPipelineIpRef.current = ip;

      setTesting(true);
      setError(null);
      try {
        await window.scanbyPrint.testPrint(ip);
        setMessage("Test print OK. Saving automatically in 5s…");

        let remaining = AUTO_SAVE_CANCEL_MS / 1000;
        setAutoSaveCountdown(remaining);

        autoSaveTimerRef.current = setInterval(() => {
          remaining -= 1;
          if (remaining <= 0) {
            clearAutoSaveTimer();
            void (async () => {
              setSaving(true);
              try {
                await window.scanbyPrint.savePrinter(ip);
                setMessage("Saved. App is now running in the system tray.");
                onSaved();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Save failed");
              } finally {
                setSaving(false);
              }
            })();
            return;
          }
          setAutoSaveCountdown(remaining);
        }, 1000);
      } catch (e) {
        autoPipelineIpRef.current = null;
        setError(e instanceof Error ? e.message : "Test print failed");
      } finally {
        setTesting(false);
      }
    },
    [onSaved, clearAutoSaveTimer],
  );

  const applyScanResult = useCallback(
    (foundPrinters: string[], scanSubnet: string | null) => {
      setPrinters(foundPrinters);
      setSubnet(scanSubnet);

      if (foundPrinters.length === 1) {
        const ip = foundPrinters[0];
        setSelectedIp(ip);
        setMode("scanned");
        if (!autoPipelineIpRef.current) {
          setMessage("One printer found — running test print…");
          void runSmartPipeline(ip);
        }
      } else if (foundPrinters.length === 0) {
        setMode("manual");
        setMessage("No printers found. Enter IP manually or rescan.");
      } else {
        setSelectedIp(foundPrinters[0]);
        setMessage(`Found ${foundPrinters.length} printers. Pick one or rescan.`);
      }
    },
    [runSmartPipeline],
  );

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setMessage(null);
    clearAutoSaveTimer();
    autoPipelineIpRef.current = null;

    try {
      const result = await window.scanbyPrint.scanPrinters();
      applyScanResult(result.printers, result.subnet ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }, [applyScanResult, clearAutoSaveTimer]);

  useEffect(() => {
    const hasRecentScan =
      lastScan && Date.now() - new Date(lastScan.completedAt).getTime() < 30_000;

    if (!hasRecentScan) {
      void runScan();
    }
  }, [runScan, lastScan]);

  useEffect(() => {
    return () => clearAutoSaveTimer();
  }, [clearAutoSaveTimer]);

  useEffect(() => {
    if (pendingPrinterPicker && pendingPrinterPicker.length > 0) {
      applyScanResult(pendingPrinterPicker, lastScan?.subnet ?? null);
      return;
    }

    if (lastScan && printers.length === 0) {
      applyScanResult(lastScan.printers, lastScan.subnet);
    }
  }, [pendingPrinterPicker, lastScan, printers.length, applyScanResult]);

  async function handleTestPrint() {
    if (!activeIp) {
      setError("Select or enter a printer IP first");
      return;
    }
    clearAutoSaveTimer();
    autoPipelineIpRef.current = null;
    setTesting(true);
    setError(null);
    try {
      await window.scanbyPrint.testPrint(activeIp);
      setMessage("Test print sent successfully.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test print failed");
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    clearAutoSaveTimer();
    setDisconnecting(true);
    setError(null);
    try {
      await window.scanbyPrint.unpair();
      onUnpaired();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSave() {
    if (!activeIp) {
      setError("Select or enter a printer IP first");
      return;
    }
    clearAutoSaveTimer();
    setSaving(true);
    setError(null);
    try {
      await window.scanbyPrint.savePrinter(activeIp);
      setMessage("Saved. App is now running in the system tray.");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function handleCancelAutoSave() {
    clearAutoSaveTimer();
    autoPipelineIpRef.current = null;
    setMessage("Auto-save cancelled. Use Save & Start when ready.");
  }

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-primary text-sm">Linked to</p>
          <p className="font-medium text-lg">{businessName}</p>
          <p className="mt-1 text-xs text-zinc-500">
            Scan runs automatically on pair. Rescan anytime to change printer.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleDisconnect()}
          disabled={disconnecting}
          className="shrink-0 rounded-md px-2 py-1 text-red-400 text-sm transition hover:bg-red-950/30 hover:text-red-300 disabled:opacity-50"
        >
          {disconnecting ? "..." : "Disconnect"}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void runScan()}
          disabled={scanBusy || testing || saving}
          className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-4 py-2 text-sm transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
        >
          {scanBusy ? "Scanning..." : "Rescan network"}
        </button>
        {subnet ? <span className="text-xs text-zinc-500">Subnet {subnet}.x</span> : null}
      </div>

      {isScanning && !testing && !saving ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2">
          <span className="size-2 animate-pulse rounded-full bg-amber-400" />
          <p className="text-amber-200 text-sm">Scanning local network for printers…</p>
        </div>
      ) : null}

      {isExternalScan && !testing && !saving ? (
        <p className="text-xs text-zinc-500">Background scan in progress…</p>
      ) : null}

      {lastScan && !scanBusy ? (
        <p className="text-xs text-zinc-500">
          Last scan {new Date(lastScan.completedAt).toLocaleTimeString()}
          {lastScan.subnet ? ` · subnet ${lastScan.subnet}.x` : ""}
          {lastScan.printers.length === 0
            ? " · no printers found"
            : ` · ${lastScan.printers.length} found`}
        </p>
      ) : null}

      {printers.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm text-zinc-400">Found</legend>
          {printers.map((ip) => (
            <label
              key={ip}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                mode === "scanned" && selectedIp === ip
                  ? "border-primary/50 bg-primary/5"
                  : "border-zinc-800 hover:border-zinc-600"
              }`}
            >
              <input
                type="radio"
                name="printer"
                checked={mode === "scanned" && selectedIp === ip}
                onChange={() => {
                  clearAutoSaveTimer();
                  autoPipelineIpRef.current = null;
                  setMode("scanned");
                  setSelectedIp(ip);
                }}
                className="accent-primary"
              />
              <span className="font-mono text-sm">{ip}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <label
        className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
          mode === "manual" ? "border-primary/50 bg-primary/5" : "border-zinc-800"
        }`}
      >
        <input
          type="radio"
          name="printer"
          checked={mode === "manual"}
          onChange={() => {
            clearAutoSaveTimer();
            autoPipelineIpRef.current = null;
            setMode("manual");
          }}
          className="mt-1 accent-primary"
        />
        <span className="flex-1">
          <span className="block text-sm">Enter IP manually</span>
          <input
            type="text"
            value={manualIp}
            onChange={(e) => {
              clearAutoSaveTimer();
              autoPipelineIpRef.current = null;
              setManualIp(e.target.value);
              setMode("manual");
            }}
            placeholder="192.168.1.42"
            className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
          />
        </span>
      </label>

      {autoSaveCountdown !== null ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2">
          <p className="text-amber-200 text-sm">Auto-saving in {autoSaveCountdown}s…</p>
          <button
            type="button"
            onClick={handleCancelAutoSave}
            className="shrink-0 rounded-md border border-amber-800/50 px-2.5 py-1 text-amber-200 text-xs transition hover:bg-amber-950/40"
          >
            Cancel
          </button>
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

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={() => void handleTestPrint()}
          disabled={testing || saving || !activeIp}
          className="flex-1 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
        >
          {testing ? "Printing..." : "Test Print"}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || testing || !activeIp}
          className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground text-sm transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save & Start"}
        </button>
      </div>
    </section>
  );
}
