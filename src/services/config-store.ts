import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isStationCredential } from "@/shared/station-credential";
import type { AppConfig, PairPayload, RegisteredPrinter } from "@/shared/types";

let userDataPath = "";
let cachedConfig: AppConfig | null = null;

export function initConfigStore(dataPath: string): void {
  userDataPath = dataPath;
  cachedConfig = loadConfigFromDisk();
}

function getConfigPath(): string {
  return join(userDataPath, "config.json");
}

function isValidConfig(value: unknown): value is AppConfig {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const o = value as Record<string, unknown>;
  return (
    typeof o.businessId === "string" &&
    typeof o.businessName === "string" &&
    typeof o.supabaseUrl === "string" &&
    typeof o.supabasePublishableKey === "string" &&
    typeof o.printerIp === "string" &&
    o.businessId.length > 0 &&
    o.supabaseUrl.length > 0 &&
    o.supabasePublishableKey.length > 0
  );
}

function parseCachedPrinters(value: unknown): RegisteredPrinter[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter(
    (entry): entry is RegisteredPrinter =>
      entry !== null &&
      typeof entry === "object" &&
      typeof (entry as RegisteredPrinter).id === "string" &&
      typeof (entry as RegisteredPrinter).address === "string",
  );
}

function loadConfigFromDisk(): AppConfig | null {
  if (!userDataPath) {
    return null;
  }

  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isValidConfig(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    return {
      ...parsed,
      printers: parseCachedPrinters(record.printers),
      kitchenTicketsEnabled: record.kitchenTicketsEnabled !== false,
      stationCredential: isStationCredential(record.stationCredential)
        ? record.stationCredential
        : undefined,
      realtimePrivate: record.realtimePrivate === true,
    };
  } catch {
    return null;
  }
}

export function getConfig(): AppConfig | null {
  return cachedConfig;
}

export function isConfigured(): boolean {
  const config = getConfig();
  return config !== null && config.printerIp.length > 0;
}

export function isPaired(): boolean {
  const config = getConfig();
  return config !== null;
}

export function savePairing(payload: PairPayload): AppConfig {
  const existing = getConfig();
  const sameBusiness = existing?.businessId === payload.businessId;
  const config: AppConfig = {
    businessId: payload.businessId,
    businessName: payload.businessName,
    supabaseUrl: payload.supabaseUrl,
    supabasePublishableKey: payload.supabasePublishableKey,
    printerIp: existing?.printerIp ?? "",
    // Pairing to a different business must not inherit the old one's printers.
    printers: sameBusiness ? existing.printers : undefined,
    kitchenTicketsEnabled: existing?.kitchenTicketsEnabled ?? true,
    // A credential is bound to one business: never carried to another.
    stationCredential:
      payload.stationCredential ?? (sameBusiness ? existing.stationCredential : undefined),
    realtimePrivate:
      payload.privateChannels ?? (sameBusiness ? existing.realtimePrivate : undefined),
  };
  saveConfig(config);
  return config;
}

/** The dashboard handing this paired station its own credential. */
export function saveStationCredential(
  stationCredential: string,
  realtimePrivate: boolean | undefined,
): AppConfig {
  const config = getConfig();
  if (!config) {
    throw new Error("Cannot save a station credential before pairing");
  }
  const updated: AppConfig = {
    ...config,
    stationCredential,
    realtimePrivate: realtimePrivate ?? config.realtimePrivate,
  };
  saveConfig(updated);
  return updated;
}

/** What the server last said about its order channels; kept for when it cannot be asked. */
export function saveRealtimeMode(realtimePrivate: boolean): void {
  const config = getConfig();
  if (!config || config.realtimePrivate === realtimePrivate) {
    return;
  }
  saveConfig({ ...config, realtimePrivate });
}

/** Replaces the cached registry wholesale — the server is the source of truth. */
export function savePrinterRegistry(
  printers: RegisteredPrinter[],
  kitchenTicketsEnabled: boolean,
): AppConfig {
  const config = getConfig();
  if (!config) {
    throw new Error("Cannot cache printers before pairing");
  }
  const updated: AppConfig = { ...config, printers, kitchenTicketsEnabled };
  saveConfig(updated);
  return updated;
}

export function savePrinterIp(printerIp: string): AppConfig {
  const config = getConfig();
  if (!config) {
    throw new Error("Cannot save printer IP before pairing");
  }
  const updated: AppConfig = { ...config, printerIp };
  saveConfig(updated);
  return updated;
}

function saveConfig(config: AppConfig): void {
  if (!userDataPath) {
    throw new Error("Config store not initialized");
  }
  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true });
  }
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
  cachedConfig = config;
}

export function clearConfig(): void {
  if (!userDataPath) {
    return;
  }
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    unlinkSync(configPath);
  }
  cachedConfig = null;
}

export function getSafeConfigSummary(): {
  businessId: string | null;
  businessName: string | null;
  printerIp: string | null;
  hasPublishableKey: boolean;
} {
  const config = getConfig();
  if (!config) {
    return {
      businessId: null,
      businessName: null,
      printerIp: null,
      hasPublishableKey: false,
    };
  }
  return {
    businessId: config.businessId,
    businessName: config.businessName,
    printerIp: config.printerIp || null,
    hasPublishableKey: config.supabasePublishableKey.length > 0,
  };
}
