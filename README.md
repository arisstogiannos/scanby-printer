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

#### Store tile icons

`resources/appx/` holds the branded MSIX tile assets (`StoreLogo`, `Square44x44Logo`,
`Square150x150Logo`, `SmallTile`, `LargeTile`, `Wide310x150Logo`, each at scale
100/125/150/200/400). **Do not delete it** — when that folder is missing, electron-builder
silently falls back to its bundled Electron sample logos and certification fails with
*10.1.1.11 On Device Tiles* ("tile icons include a default image").

Those assets and `resources/icon.png` are generated from `resources/logo.svg`:

```powershell
pnpm icons
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
| `pnpm icons` | Regenerate app icon + Store tiles from `resources/logo.svg` |
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
| POST | `/print` | Origin | Queue an order ticket (claimed auto-print or reprint) |
| POST | `/unpair` | Origin | Clear config, stop listener |
| POST | `/printer/scan` | Origin | Scan local subnet for ESC/POS printers |
| POST | `/printer/connect` | Origin | Save selected printer IP and mark setup complete |
| POST | `/printer/test` | Origin | Print a sample ticket on one registered printer |

`OPTIONS` preflight supported for CORS.

### Auth & CORS

Write endpoints (`POST /pair`, `/print`, `/unpair`, `/printer/scan`, `/printer/connect`, `/printer/test`) require one of:

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
| `stationId` | `string` | This install's stable UUID; survives restarts, unpair and re-pair |
| `stationName` | `string` | The PC's hostname |
| `reportsHeartbeat` | `boolean` | This station checks in with the server itself (see below), so the dashboard must not report its printers for it |
| `sweepsPrintJobs` | `boolean` | This station claims new-order tickets and relayed reprints itself and sweeps for missed ones (see *Delivery*), so a dashboard tab on this PC leaves them to it. True only while its authenticated API calls are succeeding (within the last 2 minutes) |

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
  },
  "event": "order_created"
}
```

`event` picks the ticket header: `order_created` (ΝΕΑ ΠΑΡΑΓΓΕΛΙΑ), `order_updated` (ΕΝΗΜΕΡΩΣΗ), `order_reprint` (ΕΠΑΝΕΚΤΥΠΩΣΗ). Omitted, it is `order_updated`.

`order_created` means *the caller already won the auto-print claim for this order* — the app prints it without claiming again, and logs it as an automatic print. Send it only from the dashboard's auto-print path; a reprint button must send `order_reprint`.

Alternate shape (dashboard DB fields): top-level or nested `order` with `table_number`, `order_number`, `created_at`, `items`. Missing `id`/`number`/`createdAt` get defaults.

Each item requires `quantity` (number) and `name` (string). `notes` optional.

**Response `200`:**

```json
{ "ok": true, "queued": true }
```

`queued: false` when this station already has the job — a new-order ticket it
queued or printed before (it prints once per order, ever), or a duplicate within
the 30s window. The caller should treat it as delivered.

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

### `POST /printer/test`

Prints the given sample ticket on one registry printer, bypassing role routing and the queue. The printer's own `fontSize` overrides the order's.

**Body:** `{ "printerId": "<registry id>", "order": { ...same shape as POST /print } }`

**Response `200`:** `{ "ok": true }`

**Errors:** `400` invalid payload, `403` forbidden origin, `422` printer not in this app's registry, `502` printer did not take the job. Builds without this endpoint answer `404`; the dashboard then falls back to `POST /print`.

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

### Who prints a new order

Every station hears the same `order_created` broadcast — this app, and every
dashboard tab sitting on the live-orders page. Exactly one of them may print it,
so each one first claims the order server-side (`POST /api/businesses/:id/orders/:orderId/claim-auto-print`,
which flips `Order.printCount` 0 → 1); the losers drop the ticket silently and
leave no history row.

A build without `PRINT_CLAIM_SECRET` cannot claim, so it does **not** auto-print
from Realtime at all — it only prints what the dashboard hands it over
`POST /print`. Release builds always carry the secret (CI enforces it); `pnpm dev`
normally does not, so in development keep the live-orders page open to see
tickets. Printing unclaimed is what produces two copies of every order.

### Delivery on a bad connection

Broadcasts are sent once and never replayed, so they only wake the station up;
the server's rows are the jobs. This app:

- **Claims idempotently.** Every claim body carries `stationId`, and the server
  hands a station its own claim back — a retry after a response the network ate
  no longer loses the ticket. This app's claims never lapse: its queue is on disk.
- **Sweeps.** On every Realtime (re)subscribe and every 30 s it asks for
  `GET …/orders/pending-print` (tickets nobody printed, or whose tab or phone
  claimed them and vanished), `GET …/print-relay-jobs/pending` (reprints nobody
  took) and `GET …/receipts/print-feed?since=` (receipts signed since the last
  look, read against the server's clock). Sweeps are skipped until a printer is
  set up, and against a server too old to answer them.
- **Claims relayed reprints.** An `order_reprint` / `receipt_reprint` broadcast
  carrying `relayJobId` is claimed (`POST …/print-relay-jobs/:id/claim`) before
  it prints; without one it prints as before. The check-in reports
  `claimsRelayJobs: true`, so the venue's phones need not stand down for it.
- **Retries until it prints or is too old.** Order and receipt jobs retry the
  claim or the printer every 5–30 s for up to an hour (reprints: 10 minutes),
  survive restarts (`pending-print-queue.json`, `pending-receipt-queue.json`),
  and the tray says once when one is waiting and again when it prints.
- **Takes only what it can print.** A relayed reprint is claimed only if a printer here may print its document; one that turns unroutable after the claim is handed back, not held.
- **Writes atomically.** Queue and ledger files are written to a temp file and renamed, so a power cut never truncates them; an unreadable file is kept aside as `*.corrupt-<time>`.
- **Prints each job once.** `delivered-prints.json` remembers, for two hours,
  every new-order ticket, relay job and receipt this station took on.

### Station check-in

While paired, and when the build carries `SCANBY_API_URL` and `PRINT_CLAIM_SECRET`,
the app reports itself to `POST /api/businesses/:id/print-stations` every 45 s —
and within ~2 s of a printer status or Realtime subscription change — with its
`stationId`, hostname, whether it is subscribed (`relaying`), app version and the
same `printers` list `GET /status` returns. The server stamps `lastSeenAt` and
treats a station silent for 2 minutes as offline. Unpair and a normal quit send a
best-effort `DELETE` to the same URL with `{ "stationId": "..." }`.

## Dashboard integration

See [plan.md](./plan.md) and the implementation plan for required Scanby dashboard changes (pair button, status polling, reprint, broadcast on insert).

## Security

- Express binds to loopback only
- Write endpoints require whitelisted `Origin` header
- Publishable key stored locally in userData — never logged
