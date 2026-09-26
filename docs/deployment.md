# Deploying the tracker — runbook for a human

**Nothing in this file has been run.** Claude has no shell access to the VPS and
performed no deployment, no installation and no change to any service: this is
the complete set of commands for a person to execute when they choose to. Every
step says what it changes and how to undo it.

**Target:** VPS `srv2000625`. The tracker binds `127.0.0.1:3100`, which the
project owner confirmed is free (`sudo ss -ltnp | grep ':3100'` returned
nothing). Step 0 below re-checks it at the moment of deployment, because "free
last week" is not "free now".

The tracker is entirely separate from the EJE application. Nothing here touches
`eje.service`, the EJE database, the EJE Caddyfile, EJE users or the EJE
deployment scripts, and the EJE application has no runtime dependency on the
tracker — if the tracker is stopped, removed or broken, EJE is unaffected.

| | EJE application | EJE Project Tracker |
|---|---|---|
| Repository | `VOID-za/EJE-Managment` | `VOID-za/eje-tracker` |
| Host | `srv2000625` | `srv2000625` (same machine, nothing shared) |
| Directory | `/srv/eje/app` | `/srv/eje-tracker/app` |
| Service | `eje.service` | `eje-tracker.service` |
| Database | its own | `eje_tracker` |
| Database user | its own | `eje_tracker_app` |
| Port | its own | `127.0.0.1:3100` |
| Environment | its own | `/etc/eje-tracker/tracker.env` |

---

## 0. Before anything: is port 3100 actually free?

```bash
sudo ss -ltnp | grep ':3100' || echo "3100 is free"
sudo systemctl is-active eje.service          # must stay active throughout
```

The owner has already run the first command and found nothing listening. Run it
again anyway at deployment time.

**If anything is listening on 3100, STOP.** Do not pick another port on the
spot — report it, and the port becomes a decision with a tracker item of its
own. The number appears in `tracker.env`, in the systemd unit's expectations
and in the SSH tunnel command, and changing it in one place only is how a
service ends up unreachable for a morning.

**Before you start, know what this never touches.** Nothing in this runbook
modifies `eje.service`, the EJE application files, the EJE PostgreSQL database,
the EJE environment, the EJE Caddy configuration or the EJE deployment process.
If a step here appears to require any of those, it is wrong — stop and report
it.

## 1. A user and a directory for it

```bash
sudo adduser --system --group --home /srv/eje-tracker --shell /usr/sbin/nologin eje-tracker
sudo mkdir -p /srv/eje-tracker /etc/eje-tracker
sudo chown eje-tracker:eje-tracker /srv/eje-tracker
```

*Undo:* `sudo deluser --remove-home eje-tracker && sudo rm -rf /etc/eje-tracker`

## 2. The code

```bash
sudo -u eje-tracker git clone https://github.com/VOID-za/eje-tracker.git /srv/eje-tracker/app
cd /srv/eje-tracker/app
sudo -u eje-tracker npm ci --omit=dev      # one runtime dependency: postgres
node --version                             # must be 22 or newer
```

*Undo:* `sudo rm -rf /srv/eje-tracker/app`

## 3. The database

Generate a password and keep it only in the environment file:

```bash
TRACKER_DB_PASSWORD="$(openssl rand -base64 32)"
sudo -u postgres psql -v tracker_password="'${TRACKER_DB_PASSWORD}'" \
     -f /srv/eje-tracker/app/deploy/database.sql
```

This creates the role `eje_tracker_app` and the database `eje_tracker`. It
grants nothing on any other database, and it does not touch the EJE database.

*Undo:* `sudo -u postgres psql -c 'DROP DATABASE eje_tracker' -c 'DROP ROLE eje_tracker_app'`

## 4. The environment file

```bash
sudo cp /srv/eje-tracker/app/deploy/tracker.env.example /etc/eje-tracker/tracker.env
sudo chown root:eje-tracker /etc/eje-tracker/tracker.env
sudo chmod 640 /etc/eje-tracker/tracker.env
sudo nano /etc/eje-tracker/tracker.env      # paste the generated password into TRACKER_DATABASE_URL
unset TRACKER_DB_PASSWORD
history -d "$(history 1)" 2>/dev/null || true
```

The file is root-owned and group-readable by the service user only. It is the
one place the database password exists on the machine.

## 4a. Check the rules before going further

The tracker's whole purpose is to be the place the project's rules are read
from, so a deployment that carries a known-bad rule register is worse than no
deployment. After the import in step 8, `/rules` will show fourteen rules (11–24) with no
text, ten (1–10) whose wording is a restatement awaiting confirmation, and
thirty-two recovered standing rules whose number is unknown, and a recovery
record of the fourteen searches behind that conclusion. That is deliberate and
is recorded as TRK-BD-01 and TRK-BD-02 — it is not something to fix on the
server by typing wording in.

## 5. The schema

```bash
cd /srv/eje-tracker/app
sudo -u eje-tracker env $(grep -v '^#' /etc/eje-tracker/tracker.env | xargs) npm run migrate
```

Running it twice is a no-op — it prints `migrations   up to date`. Migrations
are additive and are applied one transaction each: `0000_initial.sql` builds the
schema, `0001_rule_verification.sql` adds the rule-provenance columns, and
`0002_rule_variants.sql` moves every recorded variant into its own append-only
table before dropping the two columns it replaces, and
`0003_rule_provenance.sql` adds each rule's source type and date, the variant
kinds and the append-only recovery record. All four are safe against a database
that already holds rules, and running them twice prints
`migrations   up to date`.

## 6. The first account

```bash
cd /srv/eje-tracker/app
sudo -u eje-tracker env $(grep -v '^#' /etc/eje-tracker/tracker.env | xargs) \
     node bin/user-add.mjs owner@eje.example "Project owner"
```

It asks for the password twice, with the echo turned off. **The password is
never an argument, never a default, never printed and never stored** — only its
scrypt hash reaches the database. Choose it at the keyboard; do not paste it
from anywhere that keeps a copy.

To add more people later, run the same command with their address.

## 7. The service

```bash
sudo cp /srv/eje-tracker/app/deploy/eje-tracker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now eje-tracker
systemctl status eje-tracker --no-pager
journalctl -u eje-tracker -n 30 --no-pager
```

*Undo:* `sudo systemctl disable --now eje-tracker && sudo rm /etc/systemd/system/eje-tracker.service && sudo systemctl daemon-reload`

## 8. Load the project's own record into it

```bash
cd /srv/eje-tracker/app
sudo -u eje-tracker env $(grep -v '^#' /etc/eje-tracker/tracker.env | xargs) npm run import:scope
sudo -u eje-tracker env $(grep -v '^#' /etc/eje-tracker/tracker.env | xargs) npm run import:git
```

Both are read-only against `/srv/eje/app` and safe to repeat; the second run of
the same document changes nothing. Re-run them after every EJE batch — or from
a timer, once you are happy with what they do.

## 9. Reaching it

From your own machine:

```bash
ssh -N -L 3100:127.0.0.1:3100 you@the-vps
```

Then open <http://127.0.0.1:3100>. The tunnel is the only way in: the tracker
binds to loopback and Caddy has no route to it.

## Verifying it works

```bash
curl -s http://127.0.0.1:3100/healthz                 # {"status":"ok","items":…}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/           # 303 → /login
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/items  # 401
ss -ltnp | grep 3100                                  # 127.0.0.1:3100 only, never 0.0.0.0
systemctl is-active eje.service                       # unchanged: the EJE app is untouched
systemctl show eje.service -p ActiveEnterTimestamp    # unchanged since before this deployment
sudo -u postgres psql -l | grep -E 'eje_tracker|eje'  # two separate databases, two separate owners
```

And in the browser, over the tunnel: sign in, then check that `/rules` lists
rules 1–27, that 25–27 read in the owner's own words (rule 27 spelling
included), that 11–24 are shown as missing rather than filled in, and that the
recovered principles appear under "Recovered standing rules, number unknown".

## Backups

The tracker is the project's memory, and it is not reconstructible from the
scope document alone — the history, the decisions as they were recorded and the
deployment observations only exist here.

```bash
sudo -u postgres pg_dump -Fc eje_tracker > /var/backups/eje_tracker-$(date +%F).dump
# restore: sudo -u postgres pg_restore -d eje_tracker --clean /var/backups/eje_tracker-YYYY-MM-DD.dump
```

## Upgrading

```bash
cd /srv/eje-tracker/app
sudo -u eje-tracker git pull
sudo -u eje-tracker npm ci --omit=dev
sudo -u eje-tracker env $(grep -v '^#' /etc/eje-tracker/tracker.env | xargs) npm run migrate
sudo systemctl restart eje-tracker
```

*Rollback:* `sudo -u eje-tracker git checkout <previous commit>` then `npm ci --omit=dev` and restart. Migrations are additive; if one has to be undone, write the undo as its own numbered migration rather than editing the one that ran.

## Publishing it later

Don't, until somebody decides to. When that decision is made,
`deploy/Caddyfile.tracker.example` is the configuration, and it must go in its
own file that Caddy imports — **not** into the EJE Caddyfile, which the EJE
deployment can overwrite. Remove `TRACKER_INSECURE_COOKIES` from the
environment at the same time, so the session cookie is issued `Secure` again.
