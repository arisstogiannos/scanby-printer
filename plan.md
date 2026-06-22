# Scanby Print Service — Implementation Plan

## Overview

A lightweight Electron desktop app that runs silently in the background on the venue's Windows or Mac machine. It listens to Supabase Realtime for new orders and prints kitchen tickets automatically to a network thermal printer — with a manual reprint option available from the Scanby dashboard.

---

## Architecture

```
Scanby Dashboard (Next.js)
        ↓ POST /pair (venueId, anonKey, venueName)
Electron App (always running, system tray)
        ↓ subscribes to
Supabase Realtime (Broadcast — channel: orders:{venueId})
        ↑ server publishes new order event
Scanby Next.js API (on order INSERT)
        ↓
ESC/POS over TCP → Network Thermal Printer
        ↑
Scanby Dashboard (localhost:47821 — status + manual reprint)
```

---

## Components

### 1. Electron App (`scanby-print-service`)

**Tech stack:**
- Electron + Node.js
- `@supabase/supabase-js` — Realtime listener
- `node-thermal-printer` — ESC/POS print formatting
- `net` (Node built-in) — raw TCP to printer
- `express` — local HTTP server for dashboard communication
- `auto-launch` — start on boot
- `electron-builder` — packaging & installer
- `electron-updater` — silent auto-updates

**Platforms:** Windows (`.exe` installer) + Mac (`.dmg`)

---

### 2. Supabase Realtime Listener

Uses **Broadcast** — the Scanby Next.js API publishes a broadcast event on every new order. The Electron app subscribes to a venue-scoped channel and receives it instantly.

**Why Broadcast over `postgres_changes`:**
- Lower latency — no DB polling overhead
- No RLS complexity on the Realtime layer
- Server controls exactly what data is sent — no raw DB row exposed to the client
- Easier to shape the payload (e.g. pre-joined item names, table number)

**Next.js API — publish on order creation:**
```js
// After inserting the order to DB
await supabaseAdmin
  .channel(`orders:${venueId}`)
  .send({
    type: 'broadcast',
    event: 'new_order',
    payload: { order }
  })
```

**Electron app — subscribe:**
```js
function initSupabaseListener(venueId, supabaseAnonKey) {
  const supabase = createClient(SUPABASE_URL, supabaseAnonKey)

  supabase
    .channel(`orders:${venueId}`)
    .on('broadcast', { event: 'new_order' }, ({ payload }) => {
      handleNewOrder(payload.order)
    })
    .subscribe()
}
```

---

### 3. Printer Discovery & IP Management

#### Auto-scan on Setup

On Stage 2 of setup, the app scans the local subnet for devices listening on port `9100` (standard ESC/POS port). No manual IP entry needed in most cases.

```js
import * as net from 'net'
import * as os from 'os'

function getLocalSubnet() {
  const interfaces = os.networkInterfaces()
  for (const iface of Object.values(interfaces).flat()) {
    if (iface.family === 'IPv4' && !iface.internal) {
      return iface.address.split('.').slice(0, 3).join('.')
    }
  }
}

async function scanForPrinters() {
  const subnet = getLocalSubnet() // e.g. "192.168.1"
  const found = []

  const checks = Array.from({ length: 254 }, (_, i) => {
    const ip = `${subnet}.${i + 1}`
    return new Promise((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(300)
      socket.connect(9100, ip, () => {
        found.push(ip)
        socket.destroy()
        resolve()
      })
      socket.on('error', () => resolve())
      socket.on('timeout', () => { socket.destroy(); resolve() })
    })
  })

  await Promise.all(checks)
  return found // e.g. ["192.168.1.42"]
}
```

Scan takes ~2–3 seconds. If one printer is found, auto-select it. If multiple, present a pick list. Manual IP entry remains as fallback.

#### IP Persistence

Printer IP is saved to the local config file alongside venue credentials:

```json
{
  "venueId": "abc-123",
  "venueName": "Taverna Elia",
  "supabaseAnonKey": "eyJ...",
  "printerIp": "192.168.1.42"
}
```

Loaded on every app start — if config exists, skip setup entirely.

#### Auto-recovery on IP Change (v2)

Router DHCP can reassign the printer's IP after a reboot. If a print job fails to connect, the app silently re-scans the subnet, updates the saved IP, and retries — without any owner intervention.

```js
async function printWithFallback(order) {
  try {
    await printToIp(config.printerIp, order)
  } catch (err) {
    // Connection failed — IP may have changed
    updateTrayStatus('scanning')
    const found = await scanForPrinters()

    if (found.length === 1) {
      config.printerIp = found[0]
      saveConfig(config)
      await printToIp(config.printerIp, order) // retry
      updateTrayStatus('online')
    } else {
      // Ambiguous or none found — surface error to tray
      updateTrayStatus('offline')
      notifyOwner('Printer not found. Check it is powered on and connected.')
    }
  }
}
```

Tray icon transitions: 🟢 → 🟡 scanning → 🟢 recovered (or 🔴 if unresolvable).

---

### 4. Print Logic

Formats and sends ESC/POS commands directly over TCP to the printer IP.

```js
async function handleNewOrder(order) {
  const printer = new ThermalPrinter({
    type: 'EPSON',
    interface: `tcp://${printerIp}:9100`
  })

  printer.alignCenter()
  printer.bold(true)
  printer.println(`TABLE ${order.table_number}`)
  printer.bold(false)
  printer.drawLine()

  order.items.forEach(item => {
    printer.alignLeft()
    printer.println(`${item.quantity}x  ${item.name}`)
    if (item.notes) printer.println(`     > ${item.notes}`)
  })

  printer.drawLine()
  printer.alignCenter()
  printer.println(new Date().toLocaleTimeString('el-GR'))
  printer.cut()

  await printer.execute()
}
```

**Supported printers:** Any ESC/POS compatible network printer.
**Recommended hardware:** Xprinter XP-58 or XP-80 (Wi-Fi, ~€60–90).

---

### 5. Local HTTP Server

Runs on `http://localhost:47821` — allows the Scanby dashboard to communicate with the app.

**Endpoints:**

| Method | Path | Response |
|--------|------|----------|
| GET | `/status` | `{ connected: true, printer: "online" \| "offline", venue: "..." }` |
| POST | `/print` | Accepts order payload, triggers manual reprint |

```js
// Express inside Electron
app.get('/status', (req, res) => {
  res.json({
    connected: true,
    printer: printerReachable ? 'online' : 'offline',
    venue: config.venueName
  })
})

app.post('/print', async (req, res) => {
  await handleNewOrder(req.body.order)
  res.json({ ok: true })
})
```

> **Note on mixed content:** Chrome and Firefox explicitly exempt `http://localhost` from HTTPS mixed-content blocking. This pattern is standard and intentional — no SSL setup needed for v1. Safari is stricter; address with `mkcert` if Mac/iPad support becomes a priority.

---

### 6. Pairing — Dashboard Push

No token generation or copy-paste needed. The already-authenticated dashboard pushes venue config directly to the local app via the localhost endpoint.

**Flow:**

1. Owner installs and opens the Electron app → shows "Waiting to pair..." screen
2. Owner opens Scanby dashboard → Settings → Print Service → clicks **"Connect Printer"**
3. Dashboard sends `POST http://localhost:47821/pair` with venue config
4. Electron app saves config locally and initialises the Supabase listener
5. Dashboard polls `/status` → shows 🟢 Paired

**Security — two required measures:**

**1. Bind Express to `127.0.0.1` explicitly.** The default binds to `0.0.0.0` (all interfaces), making the server reachable from other devices on the local network. `127.0.0.1` is OS loopback only — no external device can reach it regardless of firewall.

**2. Validate the `Origin` header.** Even on loopback, any website open in the browser on that machine could call the endpoint. Reject anything not from the dashboard domain.

```js
// Electron — bind to loopback only
server.listen(47821, '127.0.0.1')

// Origin whitelist middleware
app.use((req, res, next) => {
  const origin = req.headers.origin || ''
  if (origin !== 'https://app.scanby.cloud') {
    return res.status(403).json({ error: 'Forbidden' })
  }
  next()
})

// Pair endpoint
app.post('/pair', (req, res) => {
  const { venueId, supabaseAnonKey, venueName } = req.body

  saveConfig({ venueId, supabaseAnonKey, venueName })
  initSupabaseListener(venueId, supabaseAnonKey)

  res.json({ ok: true })
})
```

```jsx
// Scanby dashboard — Connect Printer button
const handlePair = async () => {
  await fetch('http://localhost:47821/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      venueId: currentVenue.id,
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      venueName: currentVenue.name
    })
  })
}
```

Config is saved locally via Electron's `app.getPath('userData')` — persists across restarts.

---

### 7. Setup UI (Electron Window)

Shown only on first launch or when not yet paired. Two-stage flow:

**Stage 1 — Waiting to pair (no input needed from owner):**
```
┌─────────────────────────────────────┐
│  Scanby Print Service               │
│                                     │
│  Waiting to pair...                 │
│                                     │
│  Open your Scanby dashboard and     │
│  click "Connect Printer" to link    │
│  this device to your venue.         │
└─────────────────────────────────────┘
```

**Stage 2 — After pairing, select printer:**
```
┌─────────────────────────────────────┐
│  ✅ Paired with: Taverna Elia        │
│                                     │
│  [🔍 Scan for printers]             │
│                                     │
│  Found:                             │
│  ◉ 192.168.1.42  (recommended)     │
│  ○ Enter IP manually               │
│                                     │
│  [ Test Print ]    [ Save & Start ] │
└─────────────────────────────────────┘
```

If one printer is found, it is auto-selected. If none found, falls back to manual IP entry. After saving, window closes and app moves to system tray.

---

### 8. System Tray

App runs silently in the tray with a minimal context menu:

```
🟢 Scanby Print Service
──────────────────────
Printer: Online
Venue: Taverna Elia
──────────────────────
Settings
Test Print
──────────────────────
Quit
```

Tray icon states: 🟢 printer reachable · 🟡 scanning (auto-recovery in progress) · 🔴 printer unreachable.

---

### 9. Auto-start on Boot

Enabled by default after setup. Owner can disable from tray menu.

```js
import AutoLaunch from 'auto-launch'

const autoLauncher = new AutoLaunch({
  name: 'Scanby Print Service',
  isHidden: true // start minimized to tray
})

autoLauncher.enable()
```

---

### 10. Auto-updates

Silent background updates via `electron-updater`. App checks for updates on launch and installs them without user interaction.

```js
import { autoUpdater } from 'electron-updater'
autoUpdater.checkForUpdatesAndNotify()
```

Distribute updates via GitHub Releases or a Scanby-hosted S3 bucket.

---

## Dashboard Integration (Next.js)

### Printer Status Indicator

Poll `localhost:47821/status` every 30 seconds from the orders page.

```jsx
const [printerStatus, setPrinterStatus] = useState('unknown')

useEffect(() => {
  const check = async () => {
    try {
      const res = await fetch('http://localhost:47821/status')
      const data = await res.json()
      setPrinterStatus(data.printer)
    } catch {
      setPrinterStatus('not_running')
    }
  }
  check()
  const interval = setInterval(check, 30000)
  return () => clearInterval(interval)
}, [])
```

**UI states:**

| Status | Display |
|--------|---------|
| `online` | 🟢 Printer connected |
| `offline` | 🔴 Printer unreachable |
| `not_running` | ⚪ Print service offline — [Launch App ↗] |

### Launch App Button (Protocol Handler)

```jsx
<a href="scanby://start">Launch Print App</a>

// With download fallback if app not installed
const handleLaunch = () => {
  window.location.href = 'scanby://start'
  setTimeout(() => setShowDownload(true), 2000)
}
```

Registered in Electron at install time:
```js
app.setAsDefaultProtocolClient('scanby')
```

### Manual Reprint Button

Available on each order card in the dashboard:

```jsx
const reprintOrder = async (order) => {
  await fetch('http://localhost:47821/print', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order })
  })
}
```

---

## Distribution

- Installer hosted on Scanby dashboard (Settings → Print Service → Download)
- Windows: `.exe` (NSIS installer via electron-builder)
- Mac: `.dmg`
- Updates: via `electron-updater` pointing to GitHub Releases or S3

---

## v1 Scope

| Feature | v1 |
|---|---|
| Windows support | ✅ |
| Mac support | ✅ |
| Single printer | ✅ |
| Auto-print on new order | ✅ |
| Manual reprint from dashboard | ✅ |
| Dashboard-push pairing (no token) | ✅ |
| Auto-start on boot | ✅ |
| Printer status in dashboard | ✅ |
| Protocol handler (launch from dashboard) | ✅ |
| Auto-updates | ✅ |
| Auto-scan for printer on setup | ✅ |
| Manual IP entry fallback | ✅ |
| Auto-recovery on IP change (re-scan on failure) | ⏳ v2 |
| Multiple printers (bar / kitchen routing) | ⏳ v2 |
| Offline print queue | ⏳ v2 |
| Linux support | ⏳ v2 |

---

## Estimated Build Time

| Task | Days |
|---|---|
| Supabase broadcast listener + print logic (Node script) | 1 |
| Electron wrapper + tray + auto-launch | 1 |
| Printer discovery (subnet scan + auto-select) | 0.5 |
| Setup UI + dashboard-push pairing | 0.5 |
| Local HTTP server (status + reprint) | 0.5 |
| Dashboard integration (status indicator + reprint button) | 0.5 |
| Protocol handler + download page in dashboard | 0.5 |
| Packaging + installer (electron-builder) | 0.5 |
| Testing on Windows + Mac | 1 |
| **Total** | **~6 days** |