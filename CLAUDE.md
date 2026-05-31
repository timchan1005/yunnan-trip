# CLAUDE.md — 雲南 13 日互動行程 (Yunnan Trip)

Onboarding notes for the next developer/agent. Read this first.

## 1. What this is

A **single-purpose static website** for a private 13-day Yunnan, China trip
(2026/10/10–22: 昆明 → 大理 → 麗江 → 瀘沽湖 → 香格里拉 → 飛來寺). It has two faces:

- `index.html` — cinematic landing page (sticky-scroll story) **+** a hand-drawn
  ink-wash map at route `#/map` (overview → city region → spot drill-down).
- `map.html` — the full **interactive map app**: Leaflet base layers
  (OSM / satellite / terrain), per-day routes, Google Places search, a
  multi-currency budget tracker, and optional cloud sync.

UI text is **Traditional Chinese / Cantonese (`zh-Hant`)**. Keep it that way.

## 2. Live site & deployment

- **Live:** https://yunnan-trip-three.vercel.app/
- **Deploy:** Vercel, framework preset **"Other"**, root dir `.`, output `.`
  (no build step — files are served as-is). Push to `main` → Vercel redeploys.
- **Heads-up — stale docs:** `README.md` still says "GitHub Pages" and
  `config.js` mentions a `*.github.io` URL and a `*.perplexity.ai` referrer.
  The authoritative host is the Vercel URL above. The README also claims
  "PWA 離線支援 / Service Worker" — **there is no service worker** in the repo
  (see commit `16f4c29` "no service worker"). `manifest.json` exists and is
  linked only from `map.html`; `index.html` does not link it.

## 3. Tech stack

- Pure **HTML + CSS + vanilla JS**. No framework, no bundler, no `package.json`.
- **Leaflet 1.9.4** + `markercluster` 1.5.3 (via unpkg CDN, in `map.html`).
- **Google Maps JS / Places / Geocoding** for search (key in `config.js`),
  with **Nominatim** (OpenStreetMap) as fallback.
- Routing tiles: OSM, ArcGIS satellite, OSRM (`router.project-osrm.org`).
- **LocalStorage** for persistence; **JSONBin.io** for optional cross-device sync.
- Landing-page hash router (`#/`, `#/map`) is hand-rolled in `landing.js`.

## 4. Local development

No install needed. Serve the folder over HTTP (not `file://`, or fetch/CORS breaks):

```bash
python3 -m http.server 5000
# open http://localhost:5000          → landing + #/map
# open http://localhost:5000/map.html → interactive map
```

Search and cloud sync need network + the keys in `config.js`. The core itinerary,
hand-drawn map, and budget UI all work offline against local data.

## 5. Validation / checks (no formal test suite)

Run these before committing:

```bash
# JS syntax
for f in app.js config.js data.js landing.js mapdata.js s2t.js sync.js; do node --check "$f"; done
# JSON validity
node -e "JSON.parse(require('fs').readFileSync('itinerary.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
```

**Asset/link check** — every `img/...` reference must resolve to a real file:

```bash
grep -rhoE "img/[A-Za-z0-9_./-]+\.(webp|png|jpg|jpeg|svg)" --include=*.html --include=*.js --include=*.css . \
  | sort -u | while read -r f; do [ -f "$f" ] || echo "MISSING: $f"; done
```

Then smoke-test in a browser: load both pages, open DevTools, confirm **no 404s
and no console errors**, click through landing → `#/map` drill-down, and on
`map.html` toggle base layers / open a day / run a search.

## 6. File structure

| File | Role |
|---|---|
| `index.html` | Landing page + hand-drawn map shell (`#/`, `#/map`) |
| `map.html` | Interactive Leaflet map app shell |
| `landing.css` | Styles for `index.html` |
| `style.css` | Styles for `map.html` |
| `landing.js` | Landing scroll/story logic + hash router + ink-map drill-down |
| `app.js` | The interactive map app (largest file; map, budget, search, sync, print) |
| `data.js` | `window.DEFAULT_ITINERARY` — **the trip content** (13 days, 38 spots) |
| `mapdata.js` | `window.MAP_DATA` — overview/region/spot geometry for the hand-drawn map |
| `itinerary.json` | Standalone copy of itinerary data (keep in sync with `data.js` if used) |
| `s2t.js` | `window.simpToTrad()` — Simplified→Traditional Chinese converter |
| `sync.js` | `window.cloudSync` — JSONBin save/load |
| `config.js` | API keys (Google Maps, JSONBin) — **loaded without `?v=`** |
| `manifest.json` | PWA manifest (linked only from `map.html`) |
| `icon.svg` | App / favicon icon |
| `img/` | All artwork (`.webp`), versioned by filename prefix (see §8) |

## 7. Editing trip content

- Spots/days live in **`data.js`** (`window.DEFAULT_ITINERARY`): `{ title, dateRange, days[] }`,
  each day has `spots[]`. **Spot IDs follow `dayN-sM` / `dayN-h`** (h = hotel) and are
  the keys used by deep-links and the hand-drawn map — keep them unique and stable.
- The hand-drawn map's geometry/labels live separately in **`mapdata.js`**
  (`overview`, `regions`, `spots`). If you add a spot to `data.js` that should
  appear in the drill-down map, add its entry here too.
- Deep-link contract: landing → `map.html?focus=<id>` where `<id>` is `dayN`,
  `dayN-sM`, or `dayN-h` (parsed in `app.js`, search for `?focus`).
- `itinerary.json` is a separate copy; if you change `data.js`, decide whether
  the JSON needs the same change (verify who reads it before relying on it).

## 8. Image / asset workflow

- All images are `.webp` under `img/`, named with a **version prefix** that
  records when the art was (re)generated: `v28_…`, `v29_…`, `v30b_…`, `v32_…`,
  plus `yn_city_*` hero art. Newer prefixes supersede older ones; several
  **orphaned older versions remain in `img/` but are unreferenced** — harmless,
  safe to leave, or prune if cleaning up.
- To replace art: add the new `.webp`, update the reference in the HTML/JS, and
  bump the cache version (see §9). Don't delete an old image until you've
  confirmed nothing references it (use the §5 asset check inverted).

## 9. Cache-busting / versioning  ← IMPORTANT, this caused the last bug

- Local CSS/JS are loaded with a **`?v=<N>` query string** (e.g. `style.css?v=47`).
  The number is a **site-wide release counter**, currently **`v47`** (matches the
  latest commit `v47: …`). On each release the convention is to bump **every**
  `?v=` across **both** `index.html` and `map.html` to the same number — even for
  files whose contents didn't change — so returning visitors never get a
  half-old / half-new mix from cache.
- **Gotcha that was fixed:** `map.html` had `data.js?v=29`, `s2t.js?v=29`,
  `sync.js?v=29` while everything else was `v47`. That version skew can serve a
  stale data/util layer against a fresh `app.js`. They're now all `v47`.
  **When you bump the version, grep and update them all:**
  ```bash
  grep -rnoE '\?v=[0-9]+' --include=*.html .
  ```
- `config.js` is intentionally loaded **without** `?v=` — it changes rarely. If
  you ever change keys and need clients to pick them up immediately, add one.

## 10. Known gotchas

- **README/`config.js` are out of date** about hosting + PWA (see §2). Trust this file.
- **Secrets are public.** `config.js` ships a Google Maps key and a JSONBin
  access key in client JS — by design for this toy app. Both **must** be
  restricted (Google: HTTP-referrer + API restrictions for the Vercel domain;
  JSONBin: an *Access Key* scoped read+update to the single bin, never a Master
  Key). Anyone with the site URL can read/overwrite that one bin. Don't commit
  more sensitive keys here.
- **CDN dependency:** Leaflet + clustering load from unpkg; search needs Google
  + Nominatim; routing needs OSRM. Offline, those features degrade but the
  itinerary/budget still work.
- **No build, no tests, no CI.** Validation is manual (§5). `node` is only used
  for the syntax/JSON checks, not at runtime.
- The landing page advertises "50+景點"; `data.js` actually has 38 spots — copy
  rounding, not a data bug.

## 11. Handoff checklist

- [ ] `git pull` and serve locally (`python3 -m http.server 5000`).
- [ ] Open `/` and `/map.html`; DevTools shows **no 404s, no console errors**.
- [ ] Run the §5 JS-syntax, JSON, and missing-image checks — all clean.
- [ ] If you changed content, confirm spot IDs stay unique/stable and update
      `mapdata.js` + the `?focus=` deep-links as needed.
- [ ] If releasing, **bump every `?v=` in `index.html` and `map.html`** to the
      same new number (§9).
- [ ] Verify `config.js` key restrictions still cover the live Vercel domain.
- [ ] Push to `main` → confirm Vercel redeploy and re-check the live URL.
