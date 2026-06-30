import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type UserPreferences = {
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
    return {
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

export function initUserPreferences(dataPath: string): void {
  userDataPath = dataPath;
  preferences = loadPreferences();
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
