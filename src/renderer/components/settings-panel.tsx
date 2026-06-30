import { useState } from "react";
import { DOWNLOAD_PAGE_URL } from "@/shared/constants";
import type { UpdateState } from "@/shared/types";

type SettingsPanelProps = {
  update: UpdateState;
  onUpdated: () => void;
};

function formatLastChecked(iso: string | null): string {
  if (!iso) {
    return "Never";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Never";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SettingsPanel({ update, onUpdated }: SettingsPanelProps) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckForUpdates() {
    setChecking(true);
    setError(null);
    setMessage(null);

    try {
      const next = await window.scanbyPrint.checkForUpdates();
      onUpdated();

      if (next.isStoreBuild) {
        setMessage("Microsoft Store builds update through the Store.");
        return;
      }

      if (next.status === "ready" && next.version) {
        setMessage(`Update ${next.version} is ready to install.`);
        return;
      }

      if (next.status === "error") {
        setError(next.error ?? "Update check failed");
        return;
      }

      setMessage("You're on the latest version.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update check failed");
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div>
        <h2 className="font-medium text-sm text-zinc-200">Settings</h2>
        <p className="mt-0.5 text-xs text-zinc-500">Updates and app preferences</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleCheckForUpdates()}
          disabled={checking}
          className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
        >
          {checking ? "Checking..." : "Check for updates"}
        </button>
        <span className="text-xs text-zinc-500">
          Last checked: {formatLastChecked(update.lastCheckedAt)}
        </span>
      </div>

      {update.isStoreBuild ? (
        <p className="text-sm text-zinc-400">
          Store build —{" "}
          <a
            href={DOWNLOAD_PAGE_URL}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            download latest from GitHub
          </a>
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
    </section>
  );
}
