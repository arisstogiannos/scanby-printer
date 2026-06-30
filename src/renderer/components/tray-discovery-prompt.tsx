type TrayDiscoveryPromptProps = {
  onOpenSettings: () => void;
  onHideToTray: () => void;
  hiding: boolean;
};

export function TrayDiscoveryPrompt({
  onOpenSettings,
  onHideToTray,
  hiding,
}: TrayDiscoveryPromptProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl">
        <div>
          <p className="font-medium text-primary">Setup complete</p>
          <p className="mt-2 text-sm text-zinc-300">
            Scanby is running in the tray (near the clock). Double-click the tray icon to reopen.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground text-sm transition hover:opacity-90"
          >
            Open settings
          </button>
          <button
            type="button"
            onClick={onHideToTray}
            disabled={hiding}
            className="flex-1 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
          >
            {hiding ? "Hiding..." : "Hide to tray"}
          </button>
        </div>
      </div>
    </div>
  );
}
