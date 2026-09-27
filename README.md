# SolarWatch

Monitors a solar inverter through your **[DessMonitor](https://www.dessmonitor.com)** /
SmartESS account and sends an hourly status **heartbeat** plus **smart alerts** to
**WhatsApp** or a **webhook** (Discord / Slack / ntfy / anything).

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

- **Heartbeat** — current solar, battery, load and grid, in a clean formatted message.
- **Alerts** — grid outage, battery low/critical, overload, "reduce load", panels
  underperforming, inverter offline/fault, and more — each fires once and sends a
  "resolved" message when it clears. Sustain windows + hysteresis keep passing clouds
  and momentary spikes from triggering anything.
- **Nightly summary** — solar kWh, time on battery, grid outages, lowest battery, peaks.
- No browser, no cloud service of your own — one small Node process (~90 MB RAM).

### Heartbeat

~~~
🔆 *SOLAR UPDATE*
_Wed 10 Sep · 1:00 PM_

```
Solar     1394 W
Battery   27.0 V   100%   +4 A
Load      1246 W   36%
Grid      Grid on   244 V
Today     5.9 kWh
```
▸ _Solar charging the battery, grid available_
~~~

### Alert

~~~
🚨 *CRITICAL ALERT* · _6:40 PM_

*Battery CRITICAL: 23.1 V*
⚠️ URGENT: cut load or start a generator — inverter cuts off near 20.0 V. Battery ≈15 min left.

```
Solar     0 W
Battery   23.1 V   15%   -22 A
Load      900 W   25%
Grid      Grid off
Backup    ≈15 min
```
~~~

## Requirements

- **Node.js 20+**
- A **DessMonitor / SmartESS account** with your inverter added (the same login you use
  for the `dessmonitor.com` site or the SmartESS / SolarPower / EnergyMate app).
- One of:
  - a **WhatsApp** account to link (use a spare number — see *Disclaimer*), **or**
  - a **webhook URL** (Discord/Slack incoming webhook, an [ntfy](https://ntfy.sh) topic,
    or your own endpoint).

## Supported inverters

Anything that shows up in a DessMonitor account — the low-cost hybrid/off-grid inverters
sold as **SmartESS, EASUN, PowMr, Voltronic-style, SRNE, Sun/Growatt-clones**, etc.

The field mapping in `src/dess/data.js` was built against protocol **devcode 2341** (a
3 kW 24 V hybrid). Every reading uses a fallback chain of candidate parameter IDs, so
other models mostly work out of the box. If a value shows `—` in your messages, run
`npm run list-devices` — it dumps every parameter ID your inverter exposes — and add the
right ID to the matching chain in `src/dess/data.js` (PRs welcome).

## Quick start

```sh
git clone https://github.com/saimcyber/solarwatch.git
cd solarwatch
npm install
cp .env.example .env          # then edit it (see below)

npm run list-devices          # paste the DESS_PN/SN/DEVCODE/DEVADDR block into .env

# --- pick a notifier ---
# WhatsApp:
npm run list-groups           # scan the QR, put WHATSAPP_GROUP_ID in .env
npm run join-group -- "https://chat.whatsapp.com/XXXX"   # if not in the group yet
# Webhook: set NOTIFY_DRIVER=webhook and WEBHOOK_URL in .env

npm run send-now              # send one heartbeat to check it works
npm start                     # run it
```

To keep it running on a server, see **[deploy/DEPLOY.md](deploy/DEPLOY.md)** — a root
VPS (systemd), a managed bot panel, or Docker. `deploy/install.sh` scripts the VPS setup.

## Notifiers

Set `NOTIFY_DRIVER` in `.env`:

| driver | needs | notes |
|---|---|---|
| `whatsapp` *(default)* | `WHATSAPP_GROUP_ID` or `WHATSAPP_GROUP_NAME` | Links via QR once ([Baileys](https://github.com/WhiskeySockets/Baileys)); session saved in `.baileys_auth/`. |
| `webhook` | `WEBHOOK_URL` | `WEBHOOK_FORMAT` = `json` (default, `{"text": …}`) · `slack` · `discord` (`{"content": …}`) · `ntfy` (raw body). |

Messages use WhatsApp-flavoured markup (`*bold*`, `_italic_`, ` ``` ` blocks). On
Discord/Slack the markers render a little differently but stay readable.

## Alerts

Checked every `ALERT_CRON` (default 10 min).

| alert | level | fires when |
|---|---|---|
| Inverter offline | critical | no data for `STALE_DATA_MIN`, ~20 min |
| Inverter fault | critical | inverter reports a fault/error state |
| Battery critical / low | critical / warning | voltage ≤ threshold (auto-derived from bank voltage, or set explicitly) |
| Overloaded | critical | load ≥ `OVERLOAD_PCT` % of rated power |
| Grid off | warning | grid voltage collapses, ~20 min |
| Grid voltage abnormal | warning | grid present but outside the safe band |
| **Reduce load** | warning → critical | battery draining and solar is > 150 W short of the load; wording escalates as the battery drops |
| Battery not switching | warning | grid available but battery keeps draining past the switch-over point |
| Battery not charging | warning | spare solar but 0 A into the battery |
| Solar underperforming | warning | *(needs `PV_ARRAY_W`)* peak-sun output far below the array rating, with demand present |
| No solar in daylight | warning | ~0 solar for ~30 min inside the daylight window |

Info notes: **solar started / stopped for the day**, a **spare-solar** nudge, and the
**nightly summary**. During `QUIET_HOURS`, `ALERTS_IN_QUIET_HOURS` decides what still
comes through.

`npm run check-alerts` prints the current evaluation without sending (`--send` to send,
`--summary` to also print today's summary).

Every message actually sent is also appended to `.alerts.log` with the exact metrics
that triggered it (for tuning thresholds later) — view with `npm run alert-log`.

## Configuration

Everything is environment variables — see **`.env.example`** for the full list with
comments. Highlights:

| var | meaning | default |
|---|---|---|
| `NOTIFY_DRIVER` | `whatsapp` or `webhook` | `whatsapp` |
| `DESS_USERNAME` / `DESS_PASSWORD` | DessMonitor login | — |
| `DESS_PN` / `SN` / `DEVCODE` / `DEVADDR` | target device | from `list-devices` |
| `DESS_BATTERY_VOLTAGE` | nominal bank voltage (12/24/48) | `48` |
| `STATUS_CRON` / `ALERT_CRON` | schedules | `0 * * * *` / `*/10 * * * *` |
| `TZ` | timezone for everything | `UTC` |
| `UTILITY_NAME` | what to call mains power | `Grid` |
| `DAILY_REPORT_HOUR` | nightly-summary hour (0 disables) | `21` |
| `BATTERY_LOW_V` / `BATTERY_CRITICAL_V` | battery alert voltages | auto from bank voltage |
| `BATTERY_CAPACITY_AH` | bank Ah — enables the runtime estimate | *(off)* |
| `PV_ARRAY_W` | total panel watts — enables the underperformance alert | *(off)* |
| `SOLARWATCH_DATA_DIR` | where `.baileys_auth/` + `.state.json` live | project folder |

**120 V mains:** the grid band auto-derives from the inverter's nominal AC voltage — no
change needed. **LiFePO4:** set `BATTERY_LOW_V` / `BATTERY_CRITICAL_V` explicitly (the
auto defaults follow a lead-acid curve).

## How it works

- The DessMonitor web app talks to a SHA1-signed API at `web.dessmonitor.com`.
  SolarWatch logs in the same way (the token refreshes itself) and reads
  `querySPDeviceLastData` + `webQueryDeviceEnergyFlowEs` + `webQueryDeviceEs` every tick.
  Signing is ported from
  [`Antoxa1081/smart-ess-api-gateway`](https://github.com/Antoxa1081/smart-ess-api-gateway).
- Two [croner](https://github.com/hexagon/croner) jobs: the heartbeat and the alert
  check. Alert state lives in `.state.json`, so a restart never re-sends an alert that
  was already active.
- The alert rules are a plain array in `src/alerts.js` — `check` / `until` (hysteresis)
  / `sustain` (consecutive hits) — evaluated by a ~90-line engine.

## Development

```sh
npm test                 # 39 rule-engine tests (synthetic data, no account needed)
npm run check-alerts     # evaluate against your live account, print, don't send
```

```
src/
  config.js       env parsing, time-window helpers, threshold derivation
  dess/
    sign.js       SHA1 + query-string signing
    client.js     login, token cache/refresh, signed GET
    data.js       getStatus() → normalised + derived status; estimateBackupMinutes()
    voltage.js    voltage → SOC fallback
  notify/
    index.js      driver selector (NOTIFY_DRIVER)
    whatsapp.js   Baileys driver
    webhook.js    generic webhook driver
  format.js       status → heartbeat / alert / summary text (WhatsApp markup)
  alerts.js       the alert rule engine + rules
  daily.js        per-day stat accumulation + the nightly summary
  state.js        .state.json persistence
  index.js        the two cron loops + startup
scripts/          list-devices · list-groups · join-group · send-now · check-alerts
test/             alerts.test.mjs
deploy/           solarwatch.service · install.sh · DEPLOY.md
```

**Add an alert rule:** push an object onto `RULES` in `src/alerts.js`
(`{ id, level, sustain, check, until?, title, advice?, clearedTitle }`) and add a test.
**Support another inverter:** add candidate parameter IDs to the `??` chains in
`src/dess/data.js` — `npm run list-devices` shows what your inverter reports.

## Disclaimer

- The DessMonitor API is **undocumented / reverse-engineered**; it can change. SolarWatch
  logs errors and keeps running.
- The WhatsApp driver ([Baileys](https://github.com/WhiskeySockets/Baileys)) is an
  **unofficial client** — WhatsApp can restrict or ban automated accounts. Use a spare
  number; the webhook driver avoids this entirely.
- Backup-time and underperformance figures are **estimates**.
- Not affiliated with DessMonitor, SmartESS, or WhatsApp.

## Credits

- DessMonitor auth/signing ported from
  [`Antoxa1081/smart-ess-api-gateway`](https://github.com/Antoxa1081/smart-ess-api-gateway) (MIT).
- WhatsApp via [Baileys](https://github.com/WhiskeySockets/Baileys).

## License

MIT — see [LICENSE](LICENSE).
