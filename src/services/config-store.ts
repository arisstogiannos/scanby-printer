import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig, PairPayload } from "@/shared/types";

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
    return parsed;
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
  const config: AppConfig = {
    businessId: payload.businessId,
    businessName: payload.businessName,
    supabaseUrl: payload.supabaseUrl,
    supabasePublishableKey: payload.supabasePublishableKey,
    printerIp: existing?.printerIp ?? "",
  };
  saveConfig(config);
  return config;
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
