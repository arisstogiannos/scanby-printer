import appIcon from "@resources/icon.png";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { APP_STATE_FALLBACK_POLL_MS } from "@/shared/constants";
import { translateIpcError } from "@/shared/ipc-errors";
import type { RendererAppState } from "@/shared/types";
import { BusinessCard } from "./components/business-card";
import { PairingSuccessBanner } from "./components/pairing-success-banner";
import { PrintHistory } from "./components/print-history";
import { PrinterCard } from "./components/printer-card";
import { PrinterSetup } from "./components/printer-setup";
import { SettingsPanel } from "./components/settings-panel";
import { TrayDiscoveryPrompt } from "./components/tray-discovery-prompt";
import { UpdateBanner } from "./components/update-banner";
import { UpdatePrompt } from "./components/update-prompt";
import { WaitingPair } from "./components/waiting-pair";
import { I18nProvider } from "./i18n-provider";
import { translateError } from "./translate-error";

function AppLoadingContent() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
      <div className="flex items-center gap-3">
        <span className="size-2 animate-pulse rounded-full bg-primary" />
        <p className="text-sm text-zinc-400">{t("app.loading")}</p>
      </div>
    </main>
  );
}

function AppLoadError({ message }: { message: string }) {
  const { t } = useTranslation();
  const display =
    message === "LOAD_STATE_FAILED"
      ? t("errors.loadState")
      : translateIpcError(message, t) || t("errors.loadState");

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
      <p className="text-red-300 text-sm">{display}</p>
    </main>
  );
}

type AppContentProps = {
  state: RendererAppState;
  onRefresh: () => Promise<void>;
};

function AppContent({ state, onRefresh }: AppContentProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [trayPromptDismissed, setTrayPromptDismissed] = useState(false);
  const [hidingToTray, setHidingToTray] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null);
  const [pairingBanner, setPairingBanner] = useState<string | null>(null);
  const wasPairedRef = useRef<boolean | null>(null);
  const printerSetupRef = useRef<HTMLElement>(null);

  const paired = state.paired;
  const businessName = state.businessName;

  useEffect(() => {
    if (paired === undefined) {
      return;
    }

    if (wasPairedRef.current === null) {
      wasPairedRef.current = paired;
      return;
    }

    if (paired && !wasPairedRef.current) {
      setPairingBanner(businessName ?? t("app.yourVenue"));
      requestAnimationFrame(() => {
        printerSetupRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    wasPairedRef.current = paired;

    if (!paired) {
      setPairingBanner(null);
    }
  }, [paired, businessName, t]);

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
      setError(translateError(e, t) || t("errors.hideToTray"));
    } finally {
      setHidingToTray(false);
    }
  }

  async function handleInstallUpdate() {
    setInstallingUpdate(true);
    try {
      await window.scanbyPrint.installUpdate();
    } catch (e) {
      setError(translateError(e, t) || t("errors.installUpdate"));
      setInstallingUpdate(false);
    }
  }

  const stage =
    state.setupComplete && state.configured
      ? "complete"
      : state.paired
        ? "printer-setup"
        : "waiting-pair";

  const showUpdatePrompt = Boolean(
    state.update.status === "ready" &&
      state.update.version &&
      dismissedUpdateVersion !== state.update.version,
  );

  const showTrayPrompt =
    state.showTrayDiscovery && !trayPromptDismissed && stage === "complete" && !showUpdatePrompt;

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
          <h1 className="font-semibold text-xl tracking-tight">{t("app.title")}</h1>
          <p className="mt-0.5 text-sm text-zinc-500">{t("app.tagline")}</p>
        </div>
      </header>

      <UpdateBanner
        update={state.update}
        onInstall={() => void handleInstallUpdate()}
        installing={installingUpdate}
        hidden={showUpdatePrompt}
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
            businessName={state.businessName ?? t("app.yourVenue")}
            printerStatus={state.printerStatus}
            pendingPrinterPicker={state.pendingPrinterPicker}
            lastScan={state.lastScan}
            locale={state.locale}
            onSaved={onRefresh}
            onUnpaired={onRefresh}
          />
        </section>
      ) : null}

      {stage === "complete" ? (
        <>
          <div className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <p className="font-medium text-primary">{t("app.runningInTray")}</p>
            <p className="text-sm text-zinc-500">{t("app.runningInTrayHint")}</p>
          </div>
          <BusinessCard
            businessId={state.configSummary.businessId}
            businessName={state.businessName ?? t("app.yourVenue")}
          />
          <PrinterCard
            printerIp={state.printerIp}
            printerStatus={state.printerStatus}
            pendingPrinterPicker={state.pendingPrinterPicker}
            lastScan={state.lastScan}
            locale={state.locale}
            onUpdated={onRefresh}
          />
          <SettingsPanel update={state.update} locale={state.locale} onUpdated={onRefresh} />
        </>
      ) : null}

      {state.paired ? (
        <PrintHistory entries={state.printHistory} locale={state.locale} onRetry={onRefresh} />
      ) : null}

      <footer className="mt-auto pt-2 text-center text-xs text-zinc-600">v{state.version}</footer>

      {showUpdatePrompt && state.update.version ? (
        <UpdatePrompt
          version={state.update.version}
          onInstall={() => void handleInstallUpdate()}
          onLater={() => {
            if (state.update.version) {
              setDismissedUpdateVersion(state.update.version);
            }
          }}
          installing={installingUpdate}
          isStoreBuild={state.update.isStoreBuild}
        />
      ) : null}

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

export function App() {
  const [state, setState] = useState<RendererAppState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await window.scanbyPrint.getAppState();
      setState(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "LOAD_STATE_FAILED");
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

  if (!state) {
    const fallbackLocale =
      typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("el")
        ? "el"
        : "en";

    return (
      <I18nProvider locale={fallbackLocale}>
        {error ? <AppLoadError message={error} /> : <AppLoadingContent />}
      </I18nProvider>
    );
  }

  return (
    <I18nProvider locale={state.locale}>
      {error ? (
        <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
          <p className="text-red-300 text-sm">{error}</p>
        </main>
      ) : (
        <AppContent state={state} onRefresh={refresh} />
      )}
    </I18nProvider>
  );
}
