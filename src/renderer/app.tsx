import appIcon from "@resources/icon.png";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_STATE_FALLBACK_POLL_MS } from "@/shared/constants";
import type { RendererAppState } from "@/shared/types";
import { BusinessCard } from "./components/business-card";
import { PairingSuccessBanner } from "./components/pairing-success-banner";
import { PrintHistory } from "./components/print-history";
import { PrinterCard } from "./components/printer-card";
import { PrinterSetup } from "./components/printer-setup";
import { SettingsPanel } from "./components/settings-panel";
import { TrayDiscoveryPrompt } from "./components/tray-discovery-prompt";
import { UpdateBanner } from "./components/update-banner";
import { WaitingPair } from "./components/waiting-pair";

export function App() {
  const [state, setState] = useState<RendererAppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trayPromptDismissed, setTrayPromptDismissed] = useState(false);
  const [hidingToTray, setHidingToTray] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [pairingBanner, setPairingBanner] = useState<string | null>(null);
  const wasPairedRef = useRef<boolean | null>(null);
  const printerSetupRef = useRef<HTMLElement>(null);

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

    const unsubscribe = window.scanbyPrint.onAppStateChange((next) => {
      setState(next);
      setError(null);
    });

    const interval = setInterval(() => {
      void refresh();
    }, APP_STATE_FALLBACK_POLL_MS);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refresh]);

  const paired = state?.paired;
  const businessName = state?.businessName;

  useEffect(() => {
    if (paired === undefined) {
      return;
    }

    if (wasPairedRef.current === null) {
      wasPairedRef.current = paired;
      return;
    }

    if (paired && !wasPairedRef.current) {
      setPairingBanner(businessName ?? "Your venue");
      requestAnimationFrame(() => {
        printerSetupRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    wasPairedRef.current = paired;

    if (!paired) {
      setPairingBanner(null);
    }
  }, [paired, businessName]);

  useEffect(() => {
    if (!pairingBanner) {
      return;
    }

    const timer = setTimeout(() => {
      setPairingBanner(null);
    }, 8_000);

    return () => clearTimeout(timer);
  }, [pairingBanner]);

  async function handleHideToTray() {
    setHidingToTray(true);
    try {
      await window.scanbyPrint.hideToTray();
      setTrayPromptDismissed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not hide to tray");
    } finally {
      setHidingToTray(false);
    }
  }

  async function handleInstallUpdate() {
    setInstallingUpdate(true);
    try {
      await window.scanbyPrint.installUpdate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not install update");
      setInstallingUpdate(false);
    }
  }

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

  const showTrayPrompt = state.showTrayDiscovery && !trayPromptDismissed && stage === "complete";

  return (
    <main className="relative mx-auto flex min-h-screen max-w-md flex-col gap-5 bg-zinc-950 p-6">
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

      <UpdateBanner
        update={state.update}
        onInstall={() => void handleInstallUpdate()}
        installing={installingUpdate}
      />

      {error ? (
        <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-red-300 text-sm">
          {error}
        </p>
      ) : null}

      {pairingBanner && stage === "printer-setup" ? (
        <PairingSuccessBanner venueName={pairingBanner} />
      ) : null}

      {stage === "waiting-pair" ? <WaitingPair /> : null}

      {stage === "printer-setup" ? (
        <section ref={printerSetupRef}>
          <PrinterSetup
            businessName={state.businessName ?? "Your venue"}
            printerStatus={state.printerStatus}
            pendingPrinterPicker={state.pendingPrinterPicker}
            lastScan={state.lastScan}
            onSaved={refresh}
            onUnpaired={refresh}
          />
        </section>
      ) : null}

      {stage === "complete" ? (
        <>
          <BusinessCard businessName={state.businessName ?? "Your venue"} />
          <PrinterCard
            printerIp={state.printerIp}
            printerStatus={state.printerStatus}
            pendingPrinterPicker={state.pendingPrinterPicker}
            lastScan={state.lastScan}
            onUpdated={refresh}
          />
          <SettingsPanel update={state.update} onUpdated={refresh} />
        </>
      ) : null}

      {state.paired ? <PrintHistory entries={state.printHistory} onRetry={refresh} /> : null}

      <footer className="mt-auto pt-2 text-center text-xs text-zinc-600">v{state.version}</footer>

      {showTrayPrompt ? (
        <TrayDiscoveryPrompt
          onOpenSettings={() => setTrayPromptDismissed(true)}
          onHideToTray={() => void handleHideToTray()}
          hiding={hidingToTray}
        />
      ) : null}
    </main>
  );
}
