# Scanby Print Service — UX & Automation Suggestions

Review of the current Electron app (v1.0.11): tray-first kitchen ticket printer paired to Scanby dashboard via localhost API + Supabase Realtime.

---

## Current UX Summary


| Stage               | What user sees                                                      | Backend                                             |
| ------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| **Waiting to pair** | Instructions to open dashboard → Connect Printer                    | Local HTTP server listening on `127.0.0.1:47821`    |
| **Printer setup**   | Auto subnet scan, radio pick / manual IP, Test Print + Save & Start | Probe port 9100, save IP, enable auto-launch        |
| **Complete**        | "Running in system tray" + venue/printer status + reconnect/rescan  | Supabase broadcast listener, print queue, tray icon |


**Strengths already in place:** clear 3-step mental model, auto-scan on setup, tray status icon, print history with expandable details, manual reconnect/rescan when offline, auto-reconnect backoff for printer, Supabase channel auto-reconnect, dedupe for duplicate orders.

**Main friction:** venue staff are non-technical; app hides after setup; failures surface only in print history or logs; several automations exist in backend but are invisible in UI.

---



## UX Improvements



### P0 — High impact, low effort



#### 1. Post-setup tray discovery

After **Save & Start**, window hides. Many users lose the tray icon.

- Show one-time toast/balloon: *"Scanby is running in the tray (near the clock). Double-click to reopen."*
- On Windows: optional 3s highlight pulse on tray icon after first setup.
- Add **"Open settings"** as primary CTA before hide, not only text.



#### 2. Fix misleading pairing copy

`WaitingPair` says *"Keep this app open until pairing completes."* Pairing works via HTTP while app runs in background — window can close.

- Change to: *"Keep this app running (tray is fine). Click Connect Printer in your Scanby dashboard."*
- Add live indicator: *"Listening on port 47821"* with green dot when local server is up.



#### 3. Pairing success moment

When `paired` flips true, transition is instant with no feedback.

- Brief success banner: *"Connected to {venueName}"* + auto-scroll to printer setup.
- Optional subtle sound or system notification on first pair.



#### 4. Combine Test Print → Save when test passes

Today: Test Print and Save & Start are separate. Staff often forget Save.

- After successful test: enable **Save & Start** with emphasis, or auto-offer *"Test passed — start printing?"* single button.
- Consider: successful test auto-saves when only one printer found (with confirm).



#### 5. Show connection health, not just printer

UI shows printer status only. Supabase disconnect = silent missed orders.

- Add row: **Orders feed: Connected / Reconnecting / Disconnected**
- Tray menu: same line item.
- Red badge on tray icon when feed offline but printer online (dangerous silent failure).



#### 6. Failed print visibility

Failures only appear in collapsed history.

- System notification on failed print: *"Order #42 failed — printer offline"*
- Tray icon flash red briefly on failure.
- Failed entries: add **Retry** button in `PrintHistory` (calls existing print queue / IPC).



#### 7. Scan progress feedback

Subnet scan probes 254 hosts — UI shows only *"Scanning..."*.

- Progress: *"Scanning 192.168.1.x… 45%"* or animated step list.
- Cancel button for long scans.
- Show scanned subnet in UI (`scan` API already returns `subnet`).

---



### P1 — Medium effort, strong payoff



#### 8. Replace polling with push updates

Renderer polls `getAppState` every 1.5s.

- Push `appState` changes over IPC (`webContents.send`) → instant UI, less CPU.
- Keep poll as fallback every 30s for drift.



#### 9. Settings panel (post-complete stage)

Complete stage is read-only except reconnect/rescan. Missing controls:


| Setting                     | Why                                                        |
| --------------------------- | ---------------------------------------------------------- |
| Auto-start on boot toggle   | Enabled silently on setup; no way to disable               |
| Open at login vs hidden     | `auto-launch` uses `isHidden: true` — explain this         |
| Notification preferences    | Failures, offline, updates                                 |
| View logs / open log folder | Support calls need this                                    |
| Disconnect venue            | Buried in setup; should be in settings with confirm dialog |




#### 10. Printer setup wizard polish

- **IP validation** inline (regex) before test — avoid cryptic errors.
- **Printer nickname** optional label (*"Kitchen"*) — helps multi-venue staff.
- When multiple printers found: show *"Last used"* if reconnect history exists.
- Empty scan: troubleshooting accordion (*"Same Wi‑Fi?", "Printer powered on?", "Port 9100?"*).



#### 11. Print history upgrades

- **Reprint** action per entry (manual source).



#### 12. Update UX in app

`electron-updater` runs silently; Store builds skip it entirely.

- In-app banner: *"Update 1.0.12 ready — Restart to install"*
- Settings → Check for updates + last check time.
- Link to download page when Store build.



#### 13. Onboarding from dashboard deep link

`scanby://` protocol opens window but not a specific step.

- `scanby://setup` / `scanby://pair` — dashboard download button uses deep link.
- Pre-fill nothing sensitive; just focus correct stage.



#### 14. Accessibility & locale

- All status dots need text labels (partially done in history).
- Keyboard focus order on setup form.
- i18n hook for Greek venues (strings file, even if English-only v1).

---



### P2 — Larger UX bets



#### 15. First-run installer checklist

Single scrollable checklist UI:

1. ☐ App installed & running
2. ☐ Paired with dashboard
3. ☐ Printer found
4. ☐ Test print OK
5. ☐ Live order received

Each step auto-checks when backend state matches.

#### 16. Mini status widget

Always-on-top optional 200×80 widget for kitchen: last order #, printer dot, time since last print. For venues that don't want full window.

---



## Automation Suggestions



### Already automated (make visible)


| Automation                                   | Location               | UX gap                                                   |
| -------------------------------------------- | ---------------------- | -------------------------------------------------------- |
| Printer auto-reconnect (exponential backoff) | `printer-reconnect.ts` | User doesn't know; Reconnect button disabled when online |
| Supabase channel reconnect                   | `supabase-listener.ts` | No UI indicator                                          |
| Auto-launch on setup complete                | `auto-launch.ts`       | No toggle                                                |
| Print dedupe (30s)                           | `print-queue.ts`       | Dashboard may think reprint failed when `queued: false`  |
| Post-print grace (2s)                        | `printer-activity.ts`  | Prevents false offline — good, document for support      |


**Quick win:** add *"Auto-reconnect active"* subtitle when offline in `PrinterActions`.

---



### P0 automations to build ✅



#### A1. Auto-rescan on persistent offline

`plan.md` marks this v2. `printer-reconnect` only probes saved IP.

```
offline > 3 failed probes → run subnet scan → if exactly 1 printer OR printer MAC match → switch IP → notify user
```

- Notify: *"Printer moved to 192.168.1.105 — switched automatically"*
- If multiple found: notify + show picker on next window open.



#### A2. Failed print retry queue

On print failure (printer offline mid-job):

- Retry job 3× with backoff (5s, 15s, 45s).
- Keep status `received` until final failure.
- Tray notification only on final failure.



#### A3. Persist offline print queue

`print-queue.ts` is in-memory; jobs lost on crash/restart.

- SQLite or JSON file queue in `userData`.
- On startup: drain pending jobs after printer online.
- Mark stale jobs (>24h) as expired.



#### A4. Smart setup: scan → test → save pipeline

When scan returns exactly one IP:

1. Auto-select
2. Auto test print
3. On success → auto `savePrinter` (with 5s cancel toast)

Cuts setup from 4 clicks to 0 for typical venue.

#### A5. Health monitor cron

Every 5 min when paired:

- Probe printer  
- Check Supabase channel `SUBSCRIBED`  
- Log + tray warning if either unhealthy > 2 consecutive checks

---



### P1 automations



#### A6. Dashboard-triggered remote scan

`POST /printer/scan` exists — dashboard setup wizard can:

1. Pair
2. Trigger scan from browser
3. Show found printers in dashboard UI
4. `POST /printer/connect` with selected IP

**Removes need to interact with desktop UI at all** for printer setup.

#### A7. Order print acknowledgment to server

After successful print, optional callback to Scanby API:

```json
POST /api/print-ack { orderId, printedAt, deviceId }
```

Enables dashboard *"Sent to kitchen"* checkmarks and support debugging.

---



### P2 automations (v2 scope from plan)


| Feature                      | Notes                                                      |
| ---------------------------- | ---------------------------------------------------------- |
| Multiple printers / routing  | Bar vs kitchen rules by item category                      |
| Linux support                | Headless server mode for RPi print bridge                  |
| ESC/POS identity probe       | Query printer model during scan for better picker          |
| LAN discovery (mDNS/Bonjour) | Faster than /24 scan                                       |
| Cloud fallback               | Queue orders in Supabase edge when desktop offline > N min |


---



## Dashboard Integration Ideas

These are UX wins that span desktop + `app.scanby.cloud`:

1. **Setup wizard in dashboard** — pair → scan → connect → test, all without opening desktop window.
2. **Live status card** — printer + feed + last print time + app version.
3. **Reprint feedback** — show `queued: false` dedupe reason in UI.
4. **"Download & connect" one button** — downloads installer + opens `scanby://setup` + polls `/status`.
5. **Support bundle** — button exports redacted logs + config summary for support ticket.

---



## Suggested Priority Roadmap



### Sprint 1 (1–2 days)

- Fix pairing copy + post-setup tray toast  
- Supabase feed status in UI + tray  
- Failed print notification  
- Scan progress / subnet display



### Sprint 2 (2–3 days)

- IPC push instead of poll  
- Settings panel (auto-launch, notifications, logs)  
- Reprint from history  
- Auto-rescan on persistent offline (A1)



### Sprint 3 (3–5 days)

- Dashboard-driven printer setup (A6)  
- Persisted print queue (A3)  
- Failed job retry (A2)  
- In-app update banner

---



## Metrics to Track (inform future UX)


| Metric                         | How                                            |
| ------------------------------ | ---------------------------------------------- |
| Time to first successful print | Pair timestamp → first `printed` history entry |
| Setup abandonment              | Paired but never `setupComplete`               |
| Offline duration               | Cumulative `printerStatus === offline`         |
| Print failure rate             | `failed / (printed + failed)`                  |
| Auto-reconnect success         | Reconnect attempts → online transition         |
| Support triggers               | Manual reconnect clicks, rescan clicks         |


---



## Out of Scope / Intentional Simplicity

Keep v1 lean — avoid unless user research demands:

- Full printer driver UI (paper width, density) — use printer hardware defaults  
- User accounts inside desktop app — venue pairing is enough  
- Complex routing rules before second printer exists  
- Heavy custom theming — dark zinc UI is appropriate for back-office

---

*Generated from codebase review: renderer components, tray, print queue, reconnect monitors, local HTTP API, and plan.md v2 backlog.*