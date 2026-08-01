# 🐦‍⬛ CoinCrow

A personal transaction & budget tracker. Tap in a charge the moment a notification
hits, see per-category spend vs. your monthly budget, and get a **prorated** "on
track / over pace" signal. Enter amounts in **GBP or USD** (USD is converted to GBP
live and the GBP value is locked onto the transaction).

It's a self-contained static PWA — no server, no build step. All data lives in your
browser (this device), so **back up regularly** from Settings.

## Features

- **Add charge** — amount, GBP/USD toggle, account, category, note, pending flag.
  USD gets a live USD→GBP rate (frankfurter.app); the converted GBP and the rate are
  stored on the transaction so past entries never shift. Offline → uses the last
  cached rate.
- **Budget dashboard** — current period per-category spend vs. budget with a prorated
  expected-by-now marker; green / amber / red pacing. Month switcher for past periods.
- **Trends** — total and per-category spend across the last 6–12 periods, drawn as
  inline SVG (no external libraries → works offline), with a budget reference line.
- **Plans** — trips and gifts, each with its own budget target and its own spend,
  grouped by year and kept out of the monthly dashboard. A yearly cap across *all*
  trips (and all gifts) shows Spent / Planned / Remaining for the current year.
- **Balances** — a separate list of accounts (ISA, pension, mortgage…), each in GBP
  or USD with an optional goal. Record a balance whenever you like; USD entries lock
  the rate of the day, so past points never move. The tab charts total (GBP) and
  per-account (native) balances month by month, negatives included.
- **Settings** — edit categories + budgets (each with its own optional **rollover**
  of leftover/overspend into next month), accounts, the day the budget month starts
  on, the USD→GBP rate, and the yearly Trips/Gifts budgets. Export transactions /
  month summary / balances as CSV. Backup & restore everything as JSON.

## Run locally

Any static file server works. From this folder:

```sh
python -m http.server 8080
# then open http://localhost:8080
```

(A server is needed — the service worker and `fetch` won't run from a `file://` URL.)

## Deploy to GitHub Pages

1. Create a repo on your personal GitHub (e.g. `coincrow`) and push these files.
2. Repo → **Settings → Pages** → Source: `main` branch, `/ (root)`.
3. Open the published `https://<user>.github.io/coincrow/` on your phone.
4. Browser menu → **Add to Home Screen** to install it as an app.

## Data & privacy

- Everything is stored in `localStorage` under the key `coincrow.v1` — only on the
  device/browser you use. Nothing is sent anywhere except the FX rate lookup.
- Clearing site data / browser storage wipes it. Use **Settings → Backup all (JSON)**
  and keep the file somewhere safe (e.g. OneDrive). Restore re-imports it.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup + the six tabs (Add / Budget / Trends / Plans / Balances / Settings) |
| `app.js` | State, storage, FX, pacing math, charts, CSV/JSON export |
| `styles.css` | Crow theme (glossy black + coin gold), mobile-first |
| `manifest.json` | PWA metadata (installable, standalone) |
| `sw.js` | Service worker — caches the app shell for offline use |
| `icon.svg` | App icon (crow + coin) |
