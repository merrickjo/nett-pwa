# Nett

Merrick's weekly spending valve and liquid-fund tracker. Vanilla JS PWA, no
build step, carpe-kit v2.0.0 design, e-ink first. Local-first (localStorage);
an optional Cloudflare Worker + D1 syncs so Tesa can view the same numbers.

## How it works

- **The week is the control unit.** Weekly envelope = monthly Me allowance × 12 ÷ 52,
  topped up every Monday into the **Daily account** (BCA stand-by).
- **Day types are weights:** WFO (Tue–Thu) 1.0 · WFH (Mon, Fri) 0.4 · Weekend 0.5.
  *Safe to spend today* = what's left of the week × today's weight ÷ weights of the days left.
- **Overspend carries** into next week; **underspend is swept** to the liquid fund (Mon/Tue card).
- **What counts:** anything chosen today from the Daily account. Me = coffee, lunch, personal.
  Family = groceries you buy, family meals/outings, kids' treats (observe mode: tracked, no cap).
  Not counted: bills, mortgage, car, Mom, staff, Tesa household money, commute (cards).
- **Balance check (5 s):** type the Daily account balance; any gap vs. what's logged becomes
  "unlogged" Me spend.
- **Paybacks:** log a group meal with the expected payback; only your share counts.
- **Month view:** pay cycle 25th → 24th, Me allowance donut, Family total, liquid fund
  toward M1 62M · M2 187M · M3 374M.
- **Liquid-fund plan (0.2):** each 25th, log the payday sweep (Month → Log payday sweep).
  Plan = base sweep (Plan screen, one step per line) − family assumed − drilling − card leakage.
  Today shows the goal line with the ETA; Month shows plan vs actual per payday and
  *What moves the date* (leakage, family vs plan, drilling) in days.
- **Worth (owner only):** Worth → *Update values* once a month: type gold, stocks & funds,
  crypto, KoinWorks, house, car and the Gotrade USD value; the liquid fund fills itself from Nett.
  It saves that month's snapshot on the phone and syncs through `GET/POST /worth`, which the
  Worker refuses for the view key. Tesa's app (Viewer) hides the tab. House & car (group `use`)
  are shown apart from the investable mix. Plan → Import Worth still takes a JSON snapshot
  (`private/`, gitignored) as a backup path.

## Run locally

```bash
python3 -m http.server 8080   # open http://localhost:8080
npm test                      # engine tests (node --test)
npm run check
```

## Deploy the app (GitHub Pages)

```bash
gh repo create merrickjo/nett-pwa --private --source=. --push   # or create on github.com and push
```
Enable Pages from `main` / root. App URL: `https://merrickjo.github.io/nett-pwa/`.
For every shell change bump `VERSION` in `sw.js`.

## Deploy sync (Cloudflare Worker + D1)

```bash
cd worker
wrangler d1 create nett-db                 # paste the id into wrangler.toml
wrangler d1 execute nett-db --remote --file=schema.sql
wrangler secret put APP_KEY                # Merrick: read + write
wrangler secret put VIEW_KEY               # Tesa: read only
wrangler deploy
```
0.2 adds `/worth` to the Worker: run `wrangler deploy` again (no schema change — it uses the
existing `kv` table).
In the app → Plan → Sync: paste the Worker URL and key, choose Owner (Merrick) or
Viewer (Tesa). Merrick's phone pushes on every entry; Tesa's pulls whenever she opens it.
Never commit either key.

## Files

`index.html` shell · `app.js` UI + sync · `engine.js` pure budget math (tested) ·
`styles.css` Nett palette · `sw.js` cache-first shell · `worker/` sync API ·
`carpe-kit.*` + `fonts/` copied from `../carpe-kit` (never edit the copies).
