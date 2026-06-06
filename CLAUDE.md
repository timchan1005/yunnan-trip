# CLAUDE.md — 雲南 13 日互動行程 (Yunnan Trip)

Onboarding notes for the next developer/agent. Read this first.

## 1. What this is

A **single-purpose static website** for a private 13-day Yunnan, China trip
(2026/10/10–22: 昆明 → 大理 → 麗江 → 瀘沽湖 → 香格里拉 → 飛來寺). It has two faces:

- `index.html` — editorial travel-journal landing (full-bleed photo hero →
  overview ledger → five alternating chapter spreads → outro) **+** a hand-drawn
  ink-wash map at route `#/map` (overview → city region → spot drill-down).
  Redesigned in **v48** ("旅程手記"): per-chapter accent colours, GSAP-driven
  motion with a no-GSAP fallback. See §12.
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
- **GSAP 3.12.5 + ScrollTrigger** (cdnjs CDN, in `index.html` only) drive the
  landing motion. Loaded as **progressive enhancement**: if GSAP fails to load,
  or `prefers-reduced-motion` is set, `landing.js` falls back to
  IntersectionObserver reveals + a small rAF parallax — the page is fully usable
  either way. `map.html` does not use GSAP.
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
| `landing.css` | Styles for `index.html` (editorial system + floating nav island + preserved ink-map drill-down styles below the divider comment) |
| `style.css` | Styles for `map.html` |
| `landing.js` | Landing reveal/parallax logic (GSAP + IO fallback) + per-chapter accent tinting + hash router + ink-map drill-down |
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
  The number is a **site-wide release counter**, currently **`v51`** (interactive
  map colour alignment on `map.html` — see §16; v50 was the itinerary-menu
  refinement in §15; v49 was the cinematic pass in §14).
  On each release the convention is to bump **every**
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
- The old landing advertised "50+景點"; the v48 ledger now states the real **38**
  (`data.js` has 38 spots). Keep the ledger number in sync if you add/remove spots.

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

## 12. v48 landing redesign ("旅程手記")

The landing was rebuilt as an editorial travel journal. Structure in `index.html`:
`.hero` (full-bleed photo + type lockup) → `.ledger` (overview + animated stats)
→ `.chapters` (five `<article class="chapter">` spreads) → `.outro` (two explore
cards). The `#/map` ink-drill-down view is unchanged.

- **Chapters.** Each `.chapter` alternates image/text sides via `.chapter-flip`
  (even chapters). Per-region accent colour is set inline as
  `data-accent="#…"` on the article; `landing.js` copies it to that chapter's
  `--accent` custom property (drives the spine rule, bullets, meta). To add/edit
  a chapter, copy an `<article>` block, set `data-accent`, `data-chapter`, the
  `Day`/place meta, title, body, and list. Keep image refs pointing at real
  `img/yn_city_*.webp` art.
- **Stats** are hand-set in the `.ledger` markup (`data-count`) — they are *not*
  read from `data.js`. The spot count is **38** (matches `data.js`); update by
  hand if the itinerary changes.
- **Motion = progressive enhancement.** GSAP/ScrollTrigger (CDN) animate the hero
  intro + photo parallax and toggle `.chapter.is-visible`. If GSAP is absent or
  `prefers-reduced-motion` is set, `landing.js` uses IntersectionObserver reveals
  + a rAF parallax fallback. Reveal CSS keys only off `.is-visible`, so there is
  no flash-of-hidden-content in any path. Don't make content depend on GSAP.
- **Nav** is transparent-over-hero and turns to a frosted paper bar on scroll
  (`.is-scrolled`); the brand mark tints to the chapter currently in view.
  The nav was reworked in the v49 cinematic pass — see §14.
- The big ink-map drill-down CSS lives **below the divider comment** in
  `landing.css` and is intentionally preserved — `landing.js` renders into those
  exact class hooks. Don't rename `.map-canvas-ink`, `.ink-pin*`, `.map-level`,
  `.spt-*`, etc.

## 13. Sync state is in-memory only (no Web Storage)

The static-host **preview sandbox forbids `localStorage` / `sessionStorage` /
`indexedDB`** (also Pointer Lock + Fullscreen). `sync.js` therefore keeps all of
its bookkeeping in **module-scoped in-memory variables** (`deviceId`,
`deviceName`, `syncMeta`) that live only for the lifetime of the page. Do **not**
reintroduce any Web Storage API in shipped JS — it will get the deploy blocked.

What this changes vs. the old localStorage-backed version:

- **Device ID** is regenerated on every page load (no longer stable across
  reloads). It is only used to detect "did *another* device touch the cloud since
  my last sync"; a fresh ID per session just means same-device reloads are treated
  like a different device — the conflict prompt is `confirm()`-guarded, so nothing
  is silently clobbered.
- **Device name** auto-derives from the user agent each load; a custom name set via
  `setDeviceName()` is not persisted across reloads.
- **`last_synced_at`** resets to `0` each load, so the first `pullCloud()` after a
  reload will see the cloud as "newer" and offer a download (again `confirm()`-
  guarded — declining keeps local).

**Cloud sync still works**: the JSONBin record is the source of truth, and
push/pull operate on the live in-memory snapshot. Only cross-reload *memory* of
prior sync state is lost — acceptable for this single-trip app. The interactive
map, search, base-layer toggles, and budget UI are unaffected by this change
(they read/write the in-memory `expenses`/`state` the app already holds).

## 14. v49 cinematic pass (nav declutter + GSAP storytelling)

Three changes layered on the v48 editorial baseline. No content/data changes.

- **Landing nav = floating island (`index.html` + `landing.css`).** Single-line,
  height 58–64px (never >80). Left: `.brand` (mark + `.brand-title` +
  `.brand-sub` date, hairline-divided; sub hides ≤560px). Right `.navlinks`:
  a segmented pill `.navseg` (序章 / 手繪地圖, active state via `.navseg a.active`)
  + a single `.navlinks-go` CTA (互動地圖 → `map.html`; collapses to a circular
  icon ≤560px). `syncNav` still targets `.navlinks a[data-route]` — the segment
  links are descendants, so routing is unchanged. Don't re-add per-link text
  clutter; if you need a 3rd destination, add it to the segment, not as a 4th
  loose link.
- **Map topbar declutter (`map.html` + `style.css`).** `.topbar-inner` is one
  row, height 60px: `.brand` · day chips · `.topbar-spacer` (flex:1) · right
  cluster (`.view-tabs` 地圖/預算 → `.topbar-search` → `.sync-wrap` →
  `.share-tools`). A `.topbar-search::before` hairline separates utility icons.
  Labels collapse to icons at 1080px (share) / 920px (search + sync). **All
  element IDs are unchanged** — `app.js` uses `getElementById`, so the DOM
  reorder is safe; keep IDs stable if you move things again. Overrides live in a
  `v=49` block appended at the **end** of `style.css` (it must come after the
  ~line 1898 second-`:root` cinematic block to win the cascade).
- **GSAP scroll storytelling (`landing.js`).** `initGsap()` runs inside a single
  `gsap.context()` (revert on `pagehide` via `destroyGsap()`), and splits
  behaviour with `gsap.matchMedia()`: desktop gets hero intro stagger, scrubbed
  hero photo parallax/scale, per-chapter `clipPath` reveal + bg parallax + index
  drift + copy stagger, and outro card stagger; mobile gets only a light chapter
  bg parallax. **No pinning, no scroll hijacking, no `scroll` listener for
  animation** (nav scroll-state is a `ScrollTrigger.create`, with a plain
  passive `scroll` listener used *only* in the non-GSAP/reduced fallback). The
  `.gsap-ready .chapter-text > *` rule forces content visible (transition:none)
  so GSAP's `from` start-state, not CSS, owns the reveal — no
  flash-of-hidden-content. Reduced-motion + no-GSAP both fall back to
  IntersectionObserver `.is-visible` reveals (verified: chapters reach
  opacity:1/visible).

## 15. v50 itinerary-menu refinement (`map.html` day menu)

Purely visual restyle of the interactive map's day/itinerary menu to match the
warm ink/stone/terracotta landing palette. **No DOM, ID, class-hook, or
behaviour changes** — `app.js` (`renderDayRail`, `renderDrawer`, `buildSpotRow`,
`openDayPicker`) renders the exact same markup; day selection, map focus,
route/marker updates, sync, and share are untouched.

- **Where the CSS lives.** A `v=50` block appended at the **very end** of
  `style.css` (after the §14 `v=49` block) so it wins the cascade. It refines:
  the drawer shell (mobile bottom sheet + desktop 380px right rail), `.day-card`
  / `.day-card-head` / `.day-num` / `.day-meta`, `.spot-row` / `.spot-bullet` /
  `.spot-name` / `.spot-note`, all `.spot-tag` variants, `.day-weather`,
  `.spot-actions`, the `.day-chip` rail, and the mobile `.day-picker` sheet, plus
  a `prefers-color-scheme: dark` harmonisation block.
- **Anti-patterns deliberately removed** (the brief called these out): the 4px
  gradient side-stripe on `.day-card-head::before` (now `content:none`), the
  `border-left` stripe on `.spot-row` (now `none`, replaced by a soft background
  wash on hover + hairline `border-top` dividers between rows), and the heavy
  gradient-filled `.day-num` squircle (now a flat serif numeral on a white/stone
  disc with a thin ink ring and a small terracotta accent tick).
- **Per-day colour.** The picker dots and rail still read each day's colour from
  the inline `style="background:${d.color}"` / `data-color` that `app.js` sets —
  these match the landing chapter accents. The `.day-num` accent tick is a static
  terracotta (CSS can't read the `data-color` *attribute* as a variable without a
  JS change, and a single warm tick keeps the rail calm).
- **Overflow fix.** Long `.spot-tag.hours` strings (e.g. opening-hours + notes)
  were `white-space:nowrap` and pushed past the 380px rail. The block sets the
  hours tag to wrap (`white-space:normal; overflow-wrap:anywhere`) and adds
  `min-width:0` + `overflow-wrap:anywhere` to `.spot-name`/`.spot-info`. Verified
  zero horizontal overflow in the drawer at 1440 and 390 widths.
- **QA.** Playwright at 1440 (right rail) and 390 (bottom sheet): day-card count
  13, day-num is a flat white disc (no gradient), head stripe `none`, row
  `border-left` `0px`, selecting Day 3 updates the active chip + map markers,
  drawer opens on mobile, day picker opens and selects, no console errors, no
  overflow. Screenshots in `/tmp/qa-shots/itin-*.png`.

## 16. v51 interactive-map colour alignment (`map.html` map surface)

Purely visual: bring the Leaflet map surface in line with the warm
ink/stone/terracotta palette used by the landing and the rest of `map.html`.
**No DOM, ID, class-hook, JS, or behaviour changes.**

- **What was already aligned (no change needed).** The page bg (`--bg #faf7f2`),
  topbar, `.view-tabs`, day chips, drawer, and budget were already on the
  v49/v50 warm tokens. The route polylines and markers in `app.js` are also
  already palette-correct — `drawCasedRoute` casing is ink `#0b1426` + white halo
  + a `day.color` core (each day's accent matches the landing chapters), and
  `CATEGORIES` colours reuse the base tokens. **No JS colour constants were
  touched.**
- **What was the real mismatch.** Leaflet's own chrome — the zoom `+`/`-` bar,
  the attribution control, and the popup tip — was only restyled inside the
  `prefers-color-scheme: dark` block. In **light** mode it fell back to Leaflet's
  default white box / blue zoom glyphs / blue attribution links, which is the
  "default-Leaflet-looking control" the brief flagged.
- **Where the CSS lives.** A `v=51` block appended at the **very end** of
  `style.css` (after the §15 v=50 block) so it wins the cascade. It styles, for
  **both** light and dark: `.leaflet-bar` (warm-glass rounded capsule, ink
  glyphs, hairline dividers, disabled state), `.leaflet-control-attribution`
  (warm stone glass, `--ink-3` text, indigo links), `.leaflet-popup-tip` /
  `-close-button`, and `.leaflet-control-scale-line`. It also nudges
  `.spot-tag.time` from the brighter `--teal #2a9d8f` to the warm `--yn-jade
  #2d8a87` used across the redesign.
- **QA.** Playwright at 1440 + 390: zoom bg now `rgba(255,255,255,0.78)`
  (`--yn-glass`) with `--ink-2` glyphs and a 12px parent radius; attribution bg
  `rgba(243,237,225,0.82)` warm stone; 32/28 markers and 39 route paths render
  against the basemap; selecting Day 3 → 12 markers (day selection intact); no
  console errors; no page-level horizontal overflow (the only `getBoundingClientRect`
  hits are Leaflet tiles inside `#map` and day chips inside the `overflow-x:auto`
  `.day-rail`, both intentional scroll containers). Screenshots in
  `/tmp/qa-shots/mapcolor-*.png`.
