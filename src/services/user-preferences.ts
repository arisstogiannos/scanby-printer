import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locale } from "@/shared/i18n";

type UserPreferences = {
  locale?: Locale;
  /**
   * Who this install is to the server's station list. Lives here rather than in
   * the pairing config because unpair deletes that file, and a station that
   * re-pairs must keep its identity instead of leaving a ghost behind.
   */
  stationId?: string;
  hasSeenTrayDiscovery: boolean;
  hasSeenPairNotification: boolean;
};

let userDataPath = "";
let preferences: UserPreferences = {
  hasSeenTrayDiscovery: false,
  hasSeenPairNotification: false,
};

function getPreferencesPath(): string {
  return join(userDataPath, "preferences.json");
}

function loadPreferences(): UserPreferences {
  if (!userDataPath) {
    return { hasSeenTrayDiscovery: false, hasSeenPairNotification: false };
  }

  const path = getPreferencesPath();
  if (!existsSync(path)) {
    return { hasSeenTrayDiscovery: false, hasSeenPairNotification: false };
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") {
      return { hasSeenTrayDiscovery: false, hasSeenPairNotification: false };
    }
    const o = parsed as Record<string, unknown>;
    const locale = o.locale === "el" || o.locale === "en" ? o.locale : undefined;
    const stationId =
      typeof o.stationId === "string" && o.stationId.length > 0 ? o.stationId : undefined;
    return {
      locale,
      stationId,
      hasSeenTrayDiscovery: o.hasSeenTrayDiscovery === true,
      hasSeenPairNotification: o.hasSeenPairNotification === true,
    };
  } catch {
    return { hasSeenTrayDiscovery: false, hasSeenPairNotification: false };
  }
}

function savePreferences(): void {
  if (!userDataPath) {
    return;
  }

  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true });
  }

  writeFileSync(getPreferencesPath(), JSON.stringify(preferences, null, 2), "utf-8");
}

export function initUserPreferences(dataPath: string, defaultLocale: Locale = "en"): void {
  userDataPath = dataPath;
  preferences = loadPreferences();

  if (!preferences.locale || !preferences.stationId) {
    preferences.locale ??= defaultLocale;
    preferences.stationId ??= randomUUID();
    savePreferences();
  }
}

export function getStationId(): string {
  if (!preferences.stationId) {
    preferences.stationId = randomUUID();
    savePreferences();
  }
  return preferences.stationId;
}

export function getLocale(): Locale {
  return preferences.locale ?? "en";
}

export function setLocale(locale: Locale): void {
  if (preferences.locale === locale) {
    return;
  }
  preferences.locale = locale;
  savePreferences();
}

export function hasSeenTrayDiscovery(): boolean {
  return preferences.hasSeenTrayDiscovery;
}

export function markTrayDiscoverySeen(): void {
  if (preferences.hasSeenTrayDiscovery) {
    return;
  }
  preferences.hasSeenTrayDiscovery = true;
  savePreferences();
}

export function hasSeenPairNotification(): boolean {
  return preferences.hasSeenPairNotification;
}

export function markPairNotificationSeen(): void {
  if (preferences.hasSeenPairNotification) {
    return;
  }
  preferences.hasSeenPairNotification = true;
  savePreferences();
}
