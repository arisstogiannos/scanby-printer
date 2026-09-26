import log from "electron-log";
import { appState } from "@/services/app-state";
import { getConfig, savePrinterRegistry } from "@/services/config-store";
import type {
  PrinterRole,
  PrinterTransport,
  PrintFontSize,
  PrintOrder,
  RegisteredPrinter,
} from "@/shared/types";

const REGISTRY_TIMEOUT_MS = 8_000;

const ROLES: readonly PrinterRole[] = ["KITCHEN", "FISCAL", "ALL"];
const TRANSPORTS: readonly PrinterTransport[] = ["LAN", "EMBEDDED"];

type RegistryResponse = {
  printers?: unknown;
  kitchenTicketsEnabled?: unknown;
};

/** The registry speaks the Prisma enum; tickets speak the lowercase wire value. */
function parseFontSize(value: unknown): PrintFontSize | undefined {
  if (value === "BIG") return "big";
  if (value === "DEFAULT") return "default";
  return undefined;
}

function parsePrinter(raw: unknown): RegisteredPrinter | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const printer = raw as Record<string, unknown>;
  if (
    typeof printer.id !== "string" ||
    typeof printer.name !== "string" ||
    typeof printer.address !== "string" ||
    !ROLES.includes(printer.role as PrinterRole) ||
    !TRANSPORTS.includes(printer.transport as PrinterTransport)
  ) {
    return null;
  }

  return {
    id: printer.id,
    name: printer.name,
    role: printer.role as PrinterRole,
    transport: printer.transport as PrinterTransport,
    address: printer.address,
    enabled: printer.enabled !== false,
    fontSize: parseFontSize(printer.fontSize),
  };
}

function apiBase(): string | null {
  return process.env.SCANBY_API_URL?.replace(/\/$/, "") ?? null;
}

function isRegistrySyncConfigured(): boolean {
  return Boolean(apiBase() && process.env.PRINT_CLAIM_SECRET && getConfig()?.businessId);
}

/**
 * The printers this app routes to right now.
 *
 * Falls back to the pre-roles configuration when the registry has never synced:
 * one printer, role `ALL`, printing everything exactly as it did before. That
 * fallback is what makes this change safe to ship — a venue whose agent cannot
 * reach the API, or whose account has no registry rows yet, keeps working.
 */
export function getRoutablePrinters(): RegisteredPrinter[] {
  const config = getConfig();
  // The registry is shared by every station in the venue, and it holds the
  // built-in printers of POS terminals too. Those are reachable only from the
  // device they are bolted into — this app would open a TCP socket to a vendor
  // name and hang. It drives LAN printers and nothing else.
  const registered = (config?.printers ?? []).filter((printer) => printer.transport === "LAN");
  if (registered.length > 0) {
    return registered;
  }

  if (!config?.printerIp) {
    return [];
  }

  return [
    {
      id: `legacy:${config.printerIp}`,
      name: config.printerIp,
      role: "ALL",
      transport: "LAN",
      address: config.printerIp,
      enabled: true,
    },
  ];
}

export function isKitchenTicketPrintingEnabled(): boolean {
  return getConfig()?.kitchenTicketsEnabled !== false;
}

/** The printer's own ticket size wins; a registry without one keeps the order's. */
export function withPrinterFontSize(order: PrintOrder, printer: RegisteredPrinter): PrintOrder {
  return printer.fontSize ? { ...order, fontSize: printer.fontSize } : order;
}

export function findPrinterById(printerId: string): RegisteredPrinter | null {
  return getRoutablePrinters().find((printer) => printer.id === printerId) ?? null;
}

/**
 * Pulls the registry and reports what this station can reach.
 *
 * The report is what gets the venue's existing printer into the registry
 * without anyone typing an IP: the agent already knows the address it was set
 * up with, and the server files it as an `ALL` printer the venue can then name
 * and assign. Reporting never overwrites a name or role already set.
 */
export async function syncPrinterRegistry(): Promise<RegisteredPrinter[]> {
  const config = getConfig();
  const base = apiBase();
  const secret = process.env.PRINT_CLAIM_SECRET;

  if (!base || !secret || !config?.businessId) {
    if (!isRegistrySyncConfigured()) {
      log.info("Printer registry sync skipped — SCANBY_API_URL or PRINT_CLAIM_SECRET not set");
    }
    return getRoutablePrinters();
  }

  const url = `${base}/api/businesses/${encodeURIComponent(config.businessId)}/printers`;
  const knownAddress = config.printerIp?.trim();
  // Only report on a first sync. Once the registry holds rows, re-reporting a
  // stale local IP every poll would resurrect a printer the venue deleted.
  const shouldReport = knownAddress && (config.printers?.length ?? 0) === 0;

  try {
    const response = await fetch(url, {
      method: shouldReport ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        ...(shouldReport ? { "Content-Type": "application/json" } : {}),
      },
      ...(shouldReport
        ? { body: JSON.stringify({ printers: [{ address: knownAddress, transport: "LAN" }] }) }
        : {}),
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    });

    if (!response.ok) {
      log.warn(`Printer registry sync failed (${response.status}) — keeping the cached list`);
      return getRoutablePrinters();
    }

    const data = (await response.json()) as RegistryResponse;
    const printers = Array.isArray(data.printers)
      ? data.printers
          .map(parsePrinter)
          .filter((printer): printer is RegisteredPrinter => printer !== null)
      : [];

    savePrinterRegistry(printers, data.kitchenTicketsEnabled !== false);
    // The window and `/status` show what *this* station can drive, not every
    // printer in the venue — a POS terminal's built-in printer listed here
    // would read as "reachable" to a dashboard deciding where a receipt goes.
    const routable = getRoutablePrinters();
    appState.setPrinters(routable);
    log.info(
      `Printer registry synced: ${printers.length} printer(s), ${routable.length} reachable here`,
    );
    return routable;
  } catch (error) {
    // A cached registry is the whole point: never clear it on a failed pull.
    log.warn("Printer registry sync request failed — keeping the cached list", error);
    return getRoutablePrinters();
  }
}
