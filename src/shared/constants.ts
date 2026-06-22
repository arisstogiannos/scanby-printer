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
export const SCAN_CONCURRENCY = 50;
export const PRINT_DEDUPE_MS = 30_000;

export const SUPABASE_RECONNECT_BASE_MS = 1_000;
export const SUPABASE_RECONNECT_MAX_MS = 30_000;
