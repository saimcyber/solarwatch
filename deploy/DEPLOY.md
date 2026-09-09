# Deploying SolarWatch

SolarWatch is one long-running Node process (~90 MB RAM). It needs Node 20+, outbound
internet, and a small writable folder for `.state.json` (alert state) plus
`.baileys_auth/` (only when `NOTIFY_DRIVER=whatsapp`). It handles `SIGTERM` cleanly and
reconnects on its own.

> With `NOTIFY_DRIVER=webhook` there is no QR / session — skip every WhatsApp step below.

Pick the path that matches your host.

---

## A · Ubuntu VPS with root (systemd) — recommended

```sh
# 1. dedicated user + code
sudo adduser --system --group --home /opt/solarwatch solarwatch
sudo -u solarwatch git clone https://github.com/saimcyber/solarwatch.git /opt/solarwatch
cd /opt/solarwatch

# 2. Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. deps + config
sudo -u solarwatch npm ci
sudo -u solarwatch cp .env.example .env
sudo -u solarwatch nano .env            # DESS_USERNAME/PASSWORD + thresholds

# 4. device ids
sudo -u solarwatch npm run list-devices # paste DESS_PN/SN/DEVCODE/DEVADDR into .env

# 5. WhatsApp session — EITHER copy the one from your PC (keeps the same linked device):
#      scp -r ./.baileys_auth  user@vps:/opt/solarwatch/   ; then  chown -R solarwatch:solarwatch /opt/solarwatch/.baileys_auth
#    OR link fresh over SSH:
sudo -u solarwatch node scripts/list-groups.js   # scan the QR shown in the terminal, then Ctrl-C
#    put the printed WHATSAPP_GROUP_ID into .env  (or npm run join-group -- "<invite link>")

# 6. test
sudo -u solarwatch npm run send-now

# 7. service
sudo cp deploy/solarwatch.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now solarwatch
journalctl -u solarwatch -f
```

Update later: `cd /opt/solarwatch && sudo -u solarwatch git pull && sudo -u solarwatch npm ci && sudo systemctl restart solarwatch`.

`deploy/install.sh` automates steps 2–4 + tests if you'd rather run one script.

---

## B · Managed bot panel (Pterodactyl / "Discord-bot host")

These give you a persistent volume, a web console, a Node version picker and an
environment-variable UI — but no root or systemd. The panel keeps the process alive.

1. **Create a Node.js app.** Node version **20** (or newer).
2. **Get the code in:** point it at the git repo, or upload the folder with the panel's
   file manager (exclude `node_modules/`, `.env`, `.baileys_auth/`).
3. **Install step / console:** `npm ci` (or `npm install`).
4. **Start command:** `npm start`
5. **Config:** add every variable from `.env.example` in the panel's **Startup /
   Variables** section. No `.env` file is needed — real environment variables are used
   directly.
6. **WhatsApp session — one of:**
   - Temporarily set the start command to `node scripts/list-groups.js`, start the app,
     scan the QR in the web console, then stop and restore `npm start`; **or**
   - On your PC run `npm run list-groups` once, then upload the generated
     `.baileys_auth/` folder into the app's persistent directory.
7. **Persistent storage:** make sure `.baileys_auth/` and `.state.json` are on a
   persistent volume. If the panel's writable path isn't the app root, set
   `SOLARWATCH_DATA_DIR=/path/to/persistent/dir`.
   - If the host genuinely can't persist files: re-upload `.baileys_auth/` after a wipe.
     `.state.json` resetting is harmless — alerts just re-baseline (no duplicate spam,
     the startup message is deduped).
8. **Start.** Watch the console for `WhatsApp: connected.` and the first heartbeat.

---

## C · Docker (any host with Docker)

```sh
cp .env.example .env && nano .env      # fill it in
docker compose run --rm solarwatch node scripts/list-devices.js   # get DESS_* -> .env
docker compose run --rm solarwatch node scripts/list-groups.js    # scan QR -> WHATSAPP_GROUP_ID -> .env
docker compose up -d
docker compose logs -f
```

`compose.yaml` mounts a named volume at `/data` (`SOLARWATCH_DATA_DIR=/data`) so the
WhatsApp session and alert state survive `docker compose down`.

---

## Notes for every host

- **Timezone:** the server's own clock zone doesn't matter — SolarWatch uses `TZ` from
  the environment for every schedule, window and timestamp. Set it to your local zone
  (e.g. `TZ=Asia/Karachi`, `TZ=Europe/London`, `TZ=America/New_York`).
- **Restarts are safe:** Baileys re-links from the saved session, `.state.json` prevents
  duplicate alerts, and the "🟢 SolarWatch started" message is suppressed if the last
  start was under 30 minutes ago.
- **Message volume:** ~24 heartbeats/day + alerts + the nightly summary. Raise
  `STATUS_CRON` (e.g. `0 */3 * * *`) if that's too much.
- **Never commit `.env` or `.baileys_auth/`** — both are git-ignored. The repo itself
  contains no secrets.
