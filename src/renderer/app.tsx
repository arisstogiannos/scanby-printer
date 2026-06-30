import appIcon from "@resources/icon.png";
import { useCallback, useEffect, useState } from "react";
import type { RendererAppState } from "@/preload/index";
import { PrintHistory } from "./components/print-history";
import { PrinterActions } from "./components/printer-actions";
import { PrinterSetup } from "./components/printer-setup";
import { VenueStatus } from "./components/venue-status";
import { WaitingPair } from "./components/waiting-pair";

const POLL_MS = 1500;

export function App() {
  const [state, setState] = useState<RendererAppState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await window.scanbyPrint.getAppState();
      setState(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load app state");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
        <div className="flex items-center gap-3">
          <span className="size-2 animate-pulse rounded-full bg-primary" />
          <p className="text-sm text-zinc-400">Loading...</p>
        </div>
      </main>
    );
  }

  const stage =
    state.setupComplete && state.configured
      ? "complete"
      : state.paired
        ? "printer-setup"
        : "waiting-pair";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-5 bg-zinc-950 p-6">
      <header className="flex items-center gap-4">
        <div className="relative">
          <img src={appIcon} alt="" className="size-12 rounded-xl ring-1 ring-zinc-800" />
          {state.paired ? (
            <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-zinc-950 bg-primary" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-xl tracking-tight">Scanby Print Service</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Kitchen ticket printing for your venue</p>
        </div>
      </header>

      {error ? (
        <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-red-300 text-sm">
          {error}
        </p>
      ) : null}

      {stage === "waiting-pair" ? <WaitingPair /> : null}

      {stage === "printer-setup" ? (
        <PrinterSetup
          businessName={state.businessName ?? "Your venue"}
          onSaved={refresh}
          onUnpaired={refresh}
        />
      ) : null}

      {stage === "complete" ? (
        <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div>
            <p className="font-medium text-primary">Running in system tray</p>
            <p className="mt-1 text-sm text-zinc-500">
              New orders print automatically. You can close this window.
            </p>
          </div>
          <VenueStatus
            businessName={state.businessName ?? "Your venue"}
            printerIp={state.printerIp}
            printerStatus={state.printerStatus}
          />
          <PrinterActions
            printerIp={state.printerIp}
            printerStatus={state.printerStatus}
            pendingPrinterPicker={state.pendingPrinterPicker}
            onUpdated={refresh}
          />
        </section>
      ) : null}

      {state.paired ? <PrintHistory entries={state.printHistory} /> : null}

      <footer className="mt-auto pt-2 text-center text-xs text-zinc-600">v{state.version}</footer>
    </main>
  );
}
