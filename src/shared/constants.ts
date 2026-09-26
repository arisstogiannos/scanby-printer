export const LOCAL_SERVER_HOST = "127.0.0.1";
export const LOCAL_SERVER_PORT = 47821;

export const CHANNEL_PREFIX = "orders";

export const ALLOWED_ORIGINS = [
  "https://app.scanby.cloud",
  "https://dev.scanby.cloud",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const;

export const PRINTER_PORT = 9100;
export const SCAN_TIMEOUT_MS = 300;
export const PRINTER_PROBE_TIMEOUT_MS = 2_000;
export const POST_PRINT_GRACE_MS = 2_000;
export const SCAN_CONCURRENCY = 50;
export const PRINT_DEDUPE_MS = 30_000;

export const CENTS_PER_EUR = 100;

export const SUPABASE_RECONNECT_BASE_MS = 1_000;
export const SUPABASE_RECONNECT_MAX_MS = 30_000;

export const PRINTER_RECONNECT_INTERVAL_MS = 3_000;
export const PRINTER_RECONNECT_MAX_MS = 30_000;

/**
 * Waits between attempts at a job that did not print (or could not reach the
 * server to claim it). The last one repeats: a job is retried until it prints
 * or grows too old to be worth printing — never dropped after a count.
 */
export const PRINT_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000] as const;
/** Failed attempts before the tray says a job is waiting, once per job. */
export const PRINT_RETRY_NOTICE_AFTER = 3;
/**
 * New-order tickets, order updates and receipts stay worth printing this long.
 * The server's missed-ticket sweep looks back just as far: after a Wi-Fi drop
 * the kitchen has seen none of those orders, but a ticket from last night
 * coming out of a PC switched on in the morning helps nobody.
 */
export const AUTO_PRINT_MAX_AGE_MS = 60 * 60 * 1000;
/**
 * A reprint is someone at the pass waiting for it; after ten minutes they have
 * asked again, and a late copy is a duplicate. Matches the server's window for
 * claiming a relayed reprint.
 */
export const REPRINT_MAX_AGE_MS = 10 * 60 * 1000;
/** Signed documents with no fiscal printer are held, not retried — for up to a day. */
export const PENDING_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * How often this station asks the server for tickets it never heard about: a
 * broadcast missed while the channel was reconnecting, or a job a tab or phone
 * claimed and then abandoned.
 */
export const PRINT_SWEEP_INTERVAL_MS = 30_000;
/** How long this station remembers what it has already taken on, so nothing prints twice. */
export const DELIVERED_LEDGER_RETENTION_MS = 2 * 60 * 60 * 1000;
export const AUTO_RESCAN_AFTER_FAILED_PROBES = 3;
export const HEALTH_MONITOR_INTERVAL_MS = 5 * 60 * 1000;
export const HEALTH_UNHEALTHY_THRESHOLD = 2;
export const AUTO_SAVE_CANCEL_MS = 5_000;
export const APP_STATE_FALLBACK_POLL_MS = 30_000;
/**
 * Backstop for the printer registry. The `printers_updated` broadcast is what
 * normally refreshes it; this only covers a station that was asleep or offline
 * when the venue changed a role.
 */
export const PRINTER_REGISTRY_POLL_MS = 10 * 60 * 1000;
/**
 * The server calls a station offline after 2 minutes of silence, so this leaves
 * room for one lost check-in before the venue sees it drop.
 */
export const STATION_HEARTBEAT_INTERVAL_MS = 45_000;
export const STATION_HEARTBEAT_DEBOUNCE_MS = 2_000;
export const TRAY_PULSE_DURATION_MS = 3_000;
export const TRAY_FAILURE_FLASH_MS = 2_000;
export const DOWNLOAD_PAGE_URL = "https://github.com/arisstogiannos/scanby-printer/releases";
