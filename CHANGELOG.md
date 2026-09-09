# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] – 2026-09-10

Initial public release.

### Added

- **Hourly heartbeat** — current solar / battery / load / grid, a plain-language
  "what's happening" line, and a `💡` suggestion (reduce load / spare solar) when
  relevant.
- **Alert engine** (checked every 10 min) with sustain windows + hysteresis and a
  matching "resolved" message for each: inverter offline, inverter fault, battery
  low / critical (by voltage), overload, grid outage, abnormal grid voltage, reduce
  load, battery not switching, battery not charging, solar underperforming, no solar
  in daylight.
- **Daily summary** at a configurable hour — solar kWh, time on battery, grid outages,
  lowest battery, peaks.
- **Battery backup-time estimate** in outage messages (needs `BATTERY_CAPACITY_AH`).
- **Notifiers** — WhatsApp (via Baileys, no browser) or a generic **webhook**
  (Discord / Slack / ntfy / custom), selected with `NOTIFY_DRIVER`.
- Auto-adapting defaults: battery thresholds scale from the bank voltage, grid-voltage
  band derives from the inverter's nominal AC voltage.
- `.state.json` persistence — no duplicate alerts across restarts.
- Deployment for a root VPS (systemd), a managed bot panel, or Docker; `SOLARWATCH_DATA_DIR`
  for persistent volumes.
- 39 rule-engine tests (`npm test`).
