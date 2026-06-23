# Scanby Print Service

Electron desktop app that listens for new Scanby orders via Supabase Realtime and prints kitchen tickets to a network ESC/POS thermal printer.

## Development

```powershell
pnpm install
pnpm dev
```

## CI builds & releases (macOS + Windows)

### Manual build (no release)

Actions → *Build installers* → *Run workflow*

Download `.dmg` / `.exe` / `.appx` from the workflow run **Artifacts**. Does not publish — installed apps will not see an update.

### Release (auto-update feed)

1. Bump `version` in `package.json` (must match tag, without `v`)
2. Commit and push
3. Tag and push:

```powershell
git tag v1.0.1
git push origin v1.0.1
```

CI builds both platforms and publishes a [GitHub Release](https://github.com/scanby/scanby-printer/releases) with `latest.yml` / `latest-mac.yml`. Installed apps check this feed on launch via `electron-updater`.

Users get an OS notification when an update is ready; they confirm install/restart (not a manual re-download).

**Cost:** free for **public** repos. Private free plan: ~2000 min/month shared; macOS minutes count 10× (a mac build uses ~50–100 billed minutes).

### Windows distribution (GitHub vs Microsoft Store)

CI builds two Windows packages:

| Artifact | Channel | Auto-update |
|----------|---------|-------------|
| `Scanby-Printer.exe` (NSIS) | [GitHub Releases](https://github.com/arisstogiannos/scanby-printer/releases) — direct download | `electron-updater` via `latest.yml` |
| `Scanby-Printer.appx` (AppX/MSIX) | Microsoft Store — upload in [Partner Center](https://partner.microsoft.com/dashboard) | Windows Store |

**GitHub `.exe`:** unsigned today → SmartScreen shows “Unknown publisher”. Users click **More info → Run anyway**, or you add Authenticode signing later.

**Store `.appx`:** Microsoft re-signs on submission — no SmartScreen warning for Store installs. Store builds do **not** use `electron-updater`; updates go through the Store.

Before first Store submission, register the app in Partner Center and replace these placeholders in `package.json` → `build.appx` with the exact Partner Center values:

- `identityName`
- `publisher` (certificate Subject, e.g. `CN=Scanby, O=Scanby, C=US`)

Build Store package only locally:

```powershell
pnpm dist:win:store
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run Electron in development |
| `pnpm build` | Build app to `out/` |
| `pnpm dist` | Build installers to `release/` |
| `pnpm dist:mac` | macOS `.dmg` (requires macOS or CI) |
| `pnpm dist:win` | Windows `.exe` + `.appx` |
| `pnpm dist:win:store` | Windows `.appx` only (Store upload) |
| `pnpm typecheck` | TypeScript check |
| `pnpm check:fix` | Biome lint + format |
| `pnpm smoke-print <ip>` | Print sample ticket to printer IP |

## Local HTTP API

Base URL: `http://127.0.0.1:47821` (loopback only — not reachable from LAN).

Used by Scanby dashboard to pair, poll status, reprint orders, and unpair. App must be running.

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/status` | None | Printer + pairing status |
| POST | `/pair` | Origin | Save venue config, start Supabase listener |
| POST | `/print` | Origin | Queue manual reprint |
| POST | `/unpair` | Origin | Clear config, stop listener |
| POST | `/printer/scan` | Origin | Scan local subnet for ESC/POS printers |
| POST | `/printer/connect` | Origin | Save selected printer IP and mark setup complete |

`OPTIONS` preflight supported for CORS.

### Auth & CORS

Write endpoints (`POST /pair`, `/print`, `/unpair`, `/printer/scan`, `/printer/connect`) require one of:

- `Origin` header in whitelist (browser from dashboard)
- No `Origin` + request to `127.0.0.1` or `localhost` (local scripts)

Allowed origins:

- `https://app.scanby.cloud`
- `http://localhost:3000`
- `http://127.0.0.1:3000`

`GET /status` has no Origin check.

Forbidden response:

```json
{ "error": "Forbidden" }
```

Status `403`.

### `GET /status`

No request body.

**Response `200`:**

```json
{
  "online": true,
  "venueName": "Venue Name",
  "venueId": "uuid",
  "connected": true,
  "printer": "online",
  "businessName": "Venue Name",
  "paired": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `online` | `boolean` | Paired and printer ready (`online` or `printing`) |
| `venueName` | `string?` | Business display name when paired |
| `venueId` | `string?` | Business UUID when paired |
| `connected` | `boolean` | Always `true` while server runs |
| `printer` | `"online" \| "offline" \| "printing" \| "scanning"` | Printer state |
| `businessName` | `string \| null` | Same as `venueName` |
| `paired` | `boolean` | Config saved and listener active |

### `POST /pair`

**Headers:** `Content-Type: application/json`, `Origin: https://app.scanby.cloud`

**Body:**

```json
{
  "businessId": "uuid",
  "businessName": "Venue Name",
  "supabaseUrl": "https://xxx.supabase.co",
  "supabasePublishableKey": "eyJ..."
}
```

Legacy aliases accepted: `venueId`, `venueName`, `supabaseAnonKey`. If `supabaseUrl` omitted, derived from JWT `ref` in publishable key.

**Response `200`:**

```json
{ "ok": true }
```

**Errors:** `400` invalid payload, `403` forbidden origin, `500` pair failed.

### `POST /print`

**Headers:** `Content-Type: application/json`, `Origin` (see above)

**Body** — canonical shape:

```json
{
  "order": {
    "id": "uuid",
    "number": 12,
    "table": "5",
    "createdAt": "2026-06-11T12:00:00.000Z",
    "items": [
      { "quantity": 2, "name": "Greek Salad", "notes": "No onion" }
    ]
  }
}
```

Alternate shape (dashboard DB fields): top-level or nested `order` with `table_number`, `order_number`, `created_at`, `items`. Missing `id`/`number`/`createdAt` get defaults.

Each item requires `quantity` (number) and `name` (string). `notes` optional.

**Response `200`:**

```json
{ "ok": true, "queued": true }
```

`queued: false` when duplicate within 30s dedupe window.

**Errors:** `400` invalid order, `403` forbidden origin.

### `POST /unpair`

No body. Clears saved config and stops Supabase listener.

**Response `200`:**

```json
{ "ok": true }
```

**Errors:** `403` forbidden origin.

### `POST /printer/scan`

Scans the local /24 subnet for devices accepting TCP on port 9100 (ESC/POS). No request body.

**Headers:** `Origin` (see above)

**Response `200`:**

```json
{
  "printers": ["192.168.1.100", "192.168.1.105"],
  "subnet": "192.168.1"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `printers` | `string[]` | Reachable printer IPs, sorted |
| `subnet` | `string \| null` | Scanned subnet base (e.g. `192.168.1`) |

While scanning, `GET /status` reports `printer: "scanning"`.

**Errors:** `403` forbidden origin, `500` scan failed.

### `POST /printer/connect`

Probes the selected IP, saves it as the active printer, and completes setup. Requires prior pairing via `POST /pair`.

**Headers:** `Content-Type: application/json`, `Origin` (see above)

**Body:**

```json
{
  "ip": "192.168.1.100"
}
```

Alias accepted: `printerIp`.

**Response `200`:**

```json
{
  "ok": true,
  "printerIp": "192.168.1.100"
}
```

**Errors:** `400` invalid payload, `403` forbidden origin, `409` not paired, `422` printer unreachable, `500` connect failed.

### Examples

```javascript
// Dashboard — poll status
const status = await fetch("http://127.0.0.1:47821/status").then((r) => r.json());

// Dashboard — pair (from https://app.scanby.cloud)
await fetch("http://127.0.0.1:47821/pair", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://app.scanby.cloud",
  },
  body: JSON.stringify({
    businessId: venue.id,
    businessName: venue.name,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }),
});

// Dashboard — reprint
await fetch("http://127.0.0.1:47821/print", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://app.scanby.cloud",
  },
  body: JSON.stringify({ order }),
});
```

```powershell
# Local script (no Origin — loopback only)
Invoke-RestMethod -Uri "http://127.0.0.1:47821/status"
```

See `scripts/test-api.ps1` for smoke tests.

### Supabase Realtime

After pairing, app subscribes to broadcast:

| | Value |
|--|-------|
| Channel | `orders:{businessId}` |
| Event | `new_order` |
| Payload | `{ "order": PrintOrder }` |

Same `PrintOrder` shape as `POST /print`.

## Dashboard integration

See [plan.md](./plan.md) and the implementation plan for required Scanby dashboard changes (pair button, status polling, reprint, broadcast on insert).

## Security

- Express binds to loopback only
- Write endpoints require whitelisted `Origin` header
- Publishable key stored locally in userData — never logged
