export const LOCAL_SERVER_HOST = "127.0.0.1";
export const LOCAL_SERVER_PORT = 47821;

export const CHANNEL_PREFIX = "orders";

export const ALLOWED_ORIGINS = [
  "https://app.scanby.cloud",
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

export const PRINT_RETRY_DELAYS_MS = [5_000, 15_000, 45_000] as const;
export const PRINT_MAX_RETRIES = PRINT_RETRY_DELAYS_MS.length;
export const PENDING_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const AUTO_RESCAN_AFTER_FAILED_PROBES = 3;
export const HEALTH_MONITOR_INTERVAL_MS = 5 * 60 * 1000;
export const HEALTH_UNHEALTHY_THRESHOLD = 2;
export const AUTO_SAVE_CANCEL_MS = 5_000;
