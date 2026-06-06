/* ============================================================
   雲南之旅 · landing.js (v29)
   - Hash router: #/  #/map  #/map/{region}  #/map/{region}/{spot}
   - Scroll observers (sticky reveal + parallax)
   - 3-level map drill-down:
       Level 0 (overview): Leaflet real map + ink-wash filter + 5 region GPS pins
       Level 1 (region):   Leaflet real map fit to region bounds + spot GPS pins
       Level 2 (spot):     watercolor close-up + pointer overlay
============================================================ */

(function () {
  'use strict';

  const DATA = window.DEFAULT_ITINERARY;
  const MAP = window.MAP_DATA;
  if (!DATA || !MAP) {
    console.warn('Required data missing', { DATA: !!DATA, MAP: !!MAP });
    return;
  }

  // ---------- Helpers ----------
  function $(id) { return document.getElementById(id); }
  function escapeHTML(s) {
    return String(s || '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );
  }

  // Leaflet maps cache, so we can re-use instead of re-create
  // (v30) Ink-painting maps replace Leaflet — no map instances to track.
  let currentRegionId = null;

  // ---------- Router ----------
  function parseHash() {
    const h = (location.hash || '').replace(/^#/, '');
    const parts = h.split('/').filter(Boolean);
    if (parts.length === 0) return { view: 'landing' };
    if (parts[0] === 'map') {
      if (parts.length === 1) return { view: 'map', level: 'overview' };
      if (parts.length === 2) return { view: 'map', level: 'region', regionId: parts[1] };
      return { view: 'map', level: 'spot', regionId: parts[1], spotId: parts[2] };
    }
    return { view: 'landing' };
  }

  function handleRoute() {
    const r = parseHash();
    if (r.view === 'landing') {
      activateLanding();
    } else {
      activateMap(r);
    }
  }

  function activateLanding() {
    $('view-landing').hidden = false;
    $('view-map').hidden = true;
    $('view-map').classList.remove('is-active');
    document.body.classList.remove('on-map');
    syncNav('/');
    document.title = '雲南之旅 · 2026 秋';
  }

  function activateMap(r) {
    $('view-landing').hidden = true;
    $('view-map').hidden = false;
    $('view-map').classList.add('is-active');
    document.body.classList.add('on-map');
    syncNav('/map');
    window.scrollTo(0, 0);

    if (r.level === 'overview') {
      showLevel('overview');
      renderOverview();
      document.title = '雲南 · 總覽地圖';
    } else if (r.level === 'region') {
      const region = MAP.regions[r.regionId];
      if (!region) { location.hash = '#/map'; return; }
      showLevel('region');
      renderRegion(r.regionId, region);
      document.title = `${region.name} · 雲南`;
    } else if (r.level === 'spot') {
      const region = MAP.regions[r.regionId];
      const spot = MAP.spots[r.spotId];
      if (!region) { location.hash = '#/map'; return; }
      showLevel('spot');
      renderSpot(r.regionId, region, r.spotId, spot);
      document.title = `${spot ? spot.name : r.spotId} · 雲南`;
    }
  }

  function syncNav(active) {
    document.querySelectorAll('.navlinks a[data-route]').forEach((a) => {
      const r = a.getAttribute('data-route');
      a.classList.toggle('active', r === active);
    });
  }

  function showLevel(name) {
    document.querySelectorAll('.map-level').forEach((el) => {
      el.hidden = el.getAttribute('data-level') !== name;
    });
  }

  // ---------- Map crumb ----------
  function renderCrumb(level, regionId, spotName) {
    const trail = $('crumbTrail');
    const back = $('crumbBack');
    const backLabel = $('crumbBackLabel');

    if (level === 'overview') {
      trail.innerHTML = `<span class="crumb-cur">雲南</span>`;
      back.dataset.target = '#/';
      backLabel.textContent = '返序章';
      back.hidden = false;
    } else if (level === 'region') {
      const r = MAP.regions[regionId];
      trail.innerHTML = `
        <a href="#/map" class="crumb-link">雲南</a>
        <span class="crumb-sep">›</span>
        <span class="crumb-cur">${escapeHTML(r.name)}</span>`;
      back.dataset.target = '#/map';
      backLabel.textContent = '返雲南總覽';
      back.hidden = false;
    } else if (level === 'spot') {
      const r = MAP.regions[regionId];
      trail.innerHTML = `
        <a href="#/map" class="crumb-link">雲南</a>
        <span class="crumb-sep">›</span>
        <a href="#/map/${regionId}" class="crumb-link">${escapeHTML(r.name)}</a>
        <span class="crumb-sep">›</span>
        <span class="crumb-cur">${escapeHTML(spotName || '')}</span>`;
      back.dataset.target = `#/map/${regionId}`;
      backLabel.textContent = '返' + r.name;
      back.hidden = false;
    }
  }

  // ---------- Pin builder (ink-map version) ----------
  // v32: anchor dot is FIXED at xy (precision), label floats and is auto-placed
  // by smartPlaceLabels() to avoid overlap. Connector line drawn from dot to label.
  function buildInkPin(name, opts) {
    const isRegion = opts && opts.kind === 'region';
    const drillable = opts && opts.drillable;
    // Outer wrap is positioned at the xy anchor (the true location).
    const el = document.createElement('div');
    el.className = `ink-pin ${isRegion ? 'ink-pin-region' : 'ink-pin-spot'} ${drillable ? 'ink-pin-drill' : ''}`;
    el.innerHTML = `
      <span class="ink-pin-anchor" aria-hidden="true"></span>
      <svg class="ink-pin-leader" aria-hidden="true" width="0" height="0"><line x1="0" y1="0" x2="0" y2="0"/></svg>
      <button type="button" class="ink-pin-label">
        <span class="ink-pin-name">${escapeHTML(name)}</span>
      </button>`;
    return el;
  }

  // Smart-place all .ink-pin-label children inside `pinsContainer` (relative).
  // Strategy:
  //  1. Each pin's anchor is fixed at xy. The label is positioned in one of 8
  //     candidate offsets relative to the anchor.
  //  2. We pick the candidate with lowest overlap-score against (a) other labels
  //     already placed, (b) the stage edges, (c) every anchor dot.
  //  3. A thin SVG leader line is drawn from the anchor to the nearest edge of
  //     the chosen label so the connection stays readable.
  function smartPlaceLabels(stage) {
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    if (stageRect.width < 10 || stageRect.height < 10) return;

    const pins = Array.from(stage.querySelectorAll('.ink-pin'));
    if (!pins.length) return;

    const isMobile = stageRect.width < 560;
    // Distance from anchor centre to nearest label edge.
    const RADIUS = isMobile ? 28 : 38;
    const DIAG_RADIUS = isMobile ? 22 : 30; // diagonal uses smaller offset

    // 8 candidate placements (label centre offset from anchor in px).
    // Order matters — earlier ones are preferred when ties happen.
    const CANDIDATES = [
      { id: 'N',  dx:  0,  dy: -RADIUS, anchorEdge: 'bottom' },
      { id: 'S',  dx:  0,  dy:  RADIUS, anchorEdge: 'top' },
      { id: 'E',  dx:  RADIUS,  dy:  0, anchorEdge: 'left' },
      { id: 'W',  dx: -RADIUS,  dy:  0, anchorEdge: 'right' },
      { id: 'NE', dx:  DIAG_RADIUS, dy: -DIAG_RADIUS, anchorEdge: 'bottom-left' },
      { id: 'NW', dx: -DIAG_RADIUS, dy: -DIAG_RADIUS, anchorEdge: 'bottom-right' },
      { id: 'SE', dx:  DIAG_RADIUS, dy:  DIAG_RADIUS, anchorEdge: 'top-left' },
      { id: 'SW', dx: -DIAG_RADIUS, dy:  DIAG_RADIUS, anchorEdge: 'top-right' },
    ];

    // First pass: measure each label's natural size, compute anchor (px) inside stage.
    const items = pins.map((pin) => {
      const label = pin.querySelector('.ink-pin-label');
      // Reset label to a neutral position before measuring so it doesn't inherit a previous run's transform.
      label.style.transform = '';
      label.style.left = '0px';
      label.style.top = '0px';
      const lblRect = label.getBoundingClientRect();
      const w = lblRect.width;
      const h = lblRect.height;
      // The pin element itself is absolutely positioned via left/top % at the xy anchor;
      // its centre at translate(-50%,-50%) IS the anchor.
      const pinRect = pin.getBoundingClientRect();
      const ax = pinRect.left - stageRect.left + pinRect.width / 2;
      const ay = pinRect.top - stageRect.top + pinRect.height / 2;
      return { pin, label, w, h, ax, ay, placed: null };
    });

    // Anchor rectangles act as fixed obstacles (so labels never overlap a dot).
    const ANCHOR_R = isMobile ? 8 : 10;
    const anchorRects = items.map((it) => ({
      l: it.ax - ANCHOR_R, t: it.ay - ANCHOR_R,
      r: it.ax + ANCHOR_R, b: it.ay + ANCHOR_R,
    }));

    const placedRects = []; // labels already placed

    function overlapArea(a, b) {
      const ix = Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l));
      const iy = Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
      return ix * iy;
    }

    function offstagePenalty(r) {
      let p = 0;
      if (r.l < 4) p += (4 - r.l) * 200;
      if (r.t < 4) p += (4 - r.t) * 200;
      if (r.r > stageRect.width  - 4) p += (r.r - (stageRect.width  - 4)) * 200;
      if (r.b > stageRect.height - 4) p += (r.b - (stageRect.height - 4)) * 200;
      return p;
    }

    // Order: place region pins first (they're bigger / more important), then by
    // distance-to-edge so labels near edges get the easy choices first.
    items.sort((a, b) => {
      const aRegion = a.pin.classList.contains('ink-pin-region') ? 0 : 1;
      const bRegion = b.pin.classList.contains('ink-pin-region') ? 0 : 1;
      if (aRegion !== bRegion) return aRegion - bRegion;
      const aEdge = Math.min(a.ax, a.ay, stageRect.width - a.ax, stageRect.height - a.ay);
      const bEdge = Math.min(b.ax, b.ay, stageRect.width - b.ax, stageRect.height - b.ay);
      return aEdge - bEdge;
    });

    items.forEach((it) => {
      let best = null;
      let bestScore = Infinity;
      CANDIDATES.forEach((cand) => {
        // Label rect centered on (ax + dx, ay + dy)
        const cx = it.ax + cand.dx;
        const cy = it.ay + cand.dy;
        const rect = { l: cx - it.w / 2, t: cy - it.h / 2, r: cx + it.w / 2, b: cy + it.h / 2 };
        let score = 0;
        // Penalty against other labels
        placedRects.forEach((pr) => { score += overlapArea(rect, pr) * 3; });
        // Penalty against anchor dots
        anchorRects.forEach((ar) => { score += overlapArea(rect, ar) * 5; });
        // Penalty for going off-stage
        score += offstagePenalty(rect);
        if (score < bestScore) { bestScore = score; best = { cand, rect, cx, cy }; }
      });
      it.placed = best;
      placedRects.push(best.rect);
      // Apply position: label is absolutely positioned inside .ink-pin, anchor stays at (0,0).
      it.label.style.left = best.cand.dx + 'px';
      it.label.style.top  = best.cand.dy + 'px';
      it.label.style.transform = 'translate(-50%, -50%)';
      // Draw leader line from anchor (0,0 in pin-local coords) to nearest edge of label.
      const svg = it.pin.querySelector('.ink-pin-leader');
      const line = svg.querySelector('line');
      // Compute the entry point on the label rect closest to the anchor.
      // We work in pin-local coords (anchor at 0,0).
      const halfW = it.w / 2, halfH = it.h / 2;
      const lx = best.cand.dx, ly = best.cand.dy;
      // Where does the line from (0,0) to (lx,ly) intersect the label's edge?
      let tx = lx, ty = ly;
      if (lx !== 0 || ly !== 0) {
        const tX = halfW / Math.abs(lx || 0.0001);
        const tY = halfH / Math.abs(ly || 0.0001);
        const t = Math.min(tX, tY);
        tx = lx - Math.sign(lx) * Math.abs(lx) * t;
        ty = ly - Math.sign(ly) * Math.abs(ly) * t;
      }
      // Configure svg to span the bounding box [min,max].
      const minX = Math.min(0, tx) - 2;
      const minY = Math.min(0, ty) - 2;
      const maxX = Math.max(0, tx) + 2;
      const maxY = Math.max(0, ty) + 2;
      const sw = Math.max(1, maxX - minX);
      const sh = Math.max(1, maxY - minY);
      svg.setAttribute('width', sw);
      svg.setAttribute('height', sh);
      svg.style.left = minX + 'px';
      svg.style.top = minY + 'px';
      line.setAttribute('x1', String(-minX));
      line.setAttribute('y1', String(-minY));
      line.setAttribute('x2', String(tx - minX));
      line.setAttribute('y2', String(ty - minY));
    });
  }

  // Debounced placement — call after pins are added AND after image has loaded
  // (so the stage has its real size).
  function schedulePlacement(stage) {
    if (!stage) return;
    const img = stage.querySelector('.inkmap-img');
    const run = () => requestAnimationFrame(() => smartPlaceLabels(stage));
    if (img && !img.complete) {
      img.addEventListener('load', run, { once: true });
      // Also run immediately as a fallback (image may have intrinsic ratio already).
      run();
    } else {
      run();
    }
  }

  // ---------- Level 0: Overview ----------
  function renderOverview() {
    renderCrumb('overview');
    const o = MAP.overview;
    const stage = $('overviewStage');
    stage.innerHTML = `
      <img class="inkmap-img" src="${o.mapImg}" alt="雲南水墨地圖" />
      <div class="inkmap-pins" id="overviewPins"></div>
    `;
    const pins = stage.querySelector('#overviewPins');
    o.regions.forEach((reg) => {
      const p = buildInkPin(reg.name, { kind: 'region', drillable: true });
      p.style.left = reg.xy[0] + '%';
      p.style.top  = reg.xy[1] + '%';
      const onClick = () => { location.hash = `#/map/${reg.id}`; };
      p.querySelector('.ink-pin-label').addEventListener('click', onClick);
      pins.appendChild(p);
    });
    schedulePlacement(stage);
    $('crumbMeta').textContent = '5 個區 · 13 日';
  }

  // ---------- Level 1: Region ----------
  function renderRegion(regionId, region) {
    renderCrumb('region', regionId);
    $('regionEyebrow').textContent = '雲南 · ' + region.name;
    $('regionTitle').textContent = region.name;
    $('regionSub').textContent = region.subtitle || '';
    currentRegionId = regionId;

    const stage = $('regionStage');
    stage.innerHTML = `
      <img class="inkmap-img" src="${region.mapImg}" alt="${region.name}水墨地圖" />
      <div class="inkmap-pins" id="regionPins"></div>
    `;
    const pins = stage.querySelector('#regionPins');
    region.spots.forEach((sp) => {
      if (!sp.xy) return;
      const p = buildInkPin(sp.name, { kind: 'spot', drillable: !!sp.hasImg });
      p.style.left = sp.xy[0] + '%';
      p.style.top  = sp.xy[1] + '%';
      const onClick = () => { location.hash = `#/map/${regionId}/${sp.id}`; };
      p.querySelector('.ink-pin-label').addEventListener('click', onClick);
      pins.appendChild(p);
    });
    schedulePlacement(stage);
    $('crumbMeta').textContent = region.spots.length + ' 個景點';
  }

  // ---------- Level 2: Spot detail ----------
  function renderSpot(regionId, region, spotId, spot) {
    let s = spot;
    if (!s) {
      // Fallback when spot detail missing — should not happen in v29
      const dayMatch = spotId.match(/^day(\d+)-s(\d+)$/);
      let dayN = dayMatch ? parseInt(dayMatch[1], 10) : null;
      let sIdx = dayMatch ? parseInt(dayMatch[2], 10) - 1 : null;
      let itDay = dayN ? DATA.days.find((d) => d.day === dayN) : null;
      let itSpot = itDay && sIdx != null ? itDay.spots[sIdx] : null;
      s = {
        name: itSpot ? itSpot.name : spotId,
        region: regionId,
        img: 'img/v28_overview.webp',
        aspect: 4/3,
        intro: itSpot && itSpot.note ? itSpot.note : '更多介紹整理中。',
        pointers: [],
        fallback: true,
      };
    }
    renderCrumb('spot', regionId, s.name);

    $('spotImg').src = s.img;
    $('spotImg').alt = s.name;
    $('spotEyebrow').textContent = (region.name) + ' · 景點特寫';
    $('spotTitle').textContent = s.name;
    $('spotIntro').textContent = s.intro || '';
    $('spotDeeplink').href = `map.html?focus=${encodeURIComponent(spotId)}`;

    // Feature pointers overlaid on the image
    const ptrRoot = $('spotPointers');
    ptrRoot.innerHTML = '';
    (s.pointers || []).forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'spt-pointer';
      el.style.left = (p.x * 100) + '%';
      el.style.top  = (p.y * 100) + '%';
      el.innerHTML = `
        <span class="spt-dot"></span>
        <span class="spt-bubble">
          <span class="spt-bubble-num">${i + 1}</span>
          <span class="spt-bubble-label">${escapeHTML(p.label)}</span>
        </span>
      `;
      ptrRoot.appendChild(el);
    });

    const feats = $('spotFeatures');
    feats.innerHTML = '';
    if ((s.pointers || []).length === 0) {
      feats.innerHTML = '<p class="spot-feats-empty">特色重點整理中…</p>';
    } else {
      s.pointers.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'spot-feat-row';
        row.innerHTML = `
          <span class="spot-feat-num">${i + 1}</span>
          <span class="spot-feat-text">
            <span class="spot-feat-label">${escapeHTML(p.label)}</span>
            <span class="spot-feat-note">${escapeHTML(p.note || '')}</span>
          </span>
        `;
        feats.appendChild(row);
      });
    }

    $('crumbMeta').textContent = '';
  }

  // ---------- Crumb back button ----------
  function wireCrumb() {
    const back = $('crumbBack');
    back.addEventListener('click', () => {
      const target = back.dataset.target || '#/map';
      location.hash = target;
    });
  }

  // ---------- Top nav scroll state ----------
  function initTopnav() {
    const nav = $('topnav');
    const onScroll = () => {
      nav.classList.toggle('is-scrolled', (window.scrollY || 0) > 32);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Propagate each chapter's accent colour to its own --accent custom property,
  // and tint the global nav/brand to the chapter currently in view.
  function initAccents() {
    const chapters = Array.from(document.querySelectorAll('.chapter[data-accent]'));
    chapters.forEach((c) => c.style.setProperty('--accent', c.dataset.accent));
    if (!chapters.length) return;

    const brandMark = document.querySelector('.brand-mark');
    const defaultAccent = getComputedStyle(document.documentElement)
      .getPropertyValue('--sunset').trim() || '#c75b3a';
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && e.intersectionRatio > 0.5) {
          if (brandMark) brandMark.style.background = e.target.dataset.accent;
        }
      });
    }, { threshold: [0.5] });
    chapters.forEach((c) => io.observe(c));
    // Reset brand accent when scrolled above the first chapter (hero/ledger).
    const ledger = $('ledger');
    if (ledger && brandMark) {
      const topIo = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) brandMark.style.background = defaultAccent; });
      }, { threshold: 0.4 });
      topIo.observe(ledger);
    }
  }

  // ---------- Stats counter animation (ledger) ----------
  function initStats() {
    const stats = document.querySelectorAll('[data-stat]');
    if (!stats.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          const counter = e.target.querySelector('[data-count]');
          if (counter && !counter.dataset.done) {
            counter.dataset.done = '1';
            if (REDUCE_MOTION) {
              const t = parseInt(counter.getAttribute('data-count').replace(/,/g, ''), 10);
              if (isFinite(t)) counter.textContent = t.toLocaleString();
            } else {
              animateCount(counter);
            }
          }
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.4 });
    stats.forEach((s) => io.observe(s));
  }

  function animateCount(el) {
    const target = parseInt(el.getAttribute('data-count').replace(/,/g, ''), 10);
    if (!isFinite(target)) return;
    const duration = 1400;
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      const val = Math.round(target * eased);
      el.textContent = val.toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ---------- Chapter reveals (IntersectionObserver fallback) ----------
  // GSAP/ScrollTrigger upgrades these once loaded (initGsap). Both paths add
  // `.is-visible`, which drives the CSS reveal — so there is never a flash.
  function initChapterReveals() {
    const chapters = document.querySelectorAll('.chapter');
    if (!chapters.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('is-visible'); });
    }, { threshold: 0.25 });
    chapters.forEach((c) => io.observe(c));
  }

  // ---------- Lightweight parallax fallback (no GSAP) ----------
  function initParallaxFallback() {
    if (REDUCE_MOTION) return;
    const hero = $('heroImg');
    const bgs = Array.from(document.querySelectorAll('.chapter-bg'));
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const vh = window.innerHeight;
        const y = window.scrollY || 0;
        if (hero) hero.style.transform = `translate3d(0, ${(y * 0.12).toFixed(1)}px, 0) scale(1.06)`;
        bgs.forEach((bg) => {
          const r = bg.getBoundingClientRect();
          if (r.bottom < -200 || r.top > vh + 200) return;
          const offset = (r.top + r.height / 2 - vh / 2) / vh; // -1..1
          bg.style.transform = `translate3d(0, ${(-offset * 36).toFixed(1)}px, 0)`;
        });
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- GSAP / ScrollTrigger upgrade (progressive enhancement) ----------
  // Only runs when GSAP loaded AND motion is allowed. Cleanup-safe: all triggers
  // are killed if the landing view is torn down (it isn't, but kept tidy).
  let gsapStarted = false;
  function initGsap() {
    if (gsapStarted) return;
    if (REDUCE_MOTION) return;                 // honour reduced motion
    if (typeof window.gsap === 'undefined' || typeof window.ScrollTrigger === 'undefined') return;
    gsapStarted = true;

    const gsap = window.gsap;
    gsap.registerPlugin(window.ScrollTrigger);
    document.documentElement.classList.add('gsap-ready');

    // Hero: intro stagger of the type lockup + parallax on the photo as you scroll.
    const heroBits = gsap.utils.toArray('[data-hero]');
    if (heroBits.length) {
      gsap.set(heroBits, { y: 26, autoAlpha: 0 });
      gsap.to(heroBits, { y: 0, autoAlpha: 1, duration: 1.1, ease: 'power3.out', stagger: 0.12, delay: 0.15 });
    }
    const heroImg = $('heroImg');
    if (heroImg) {
      gsap.to(heroImg, {
        yPercent: 14, ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
      });
    }

    // Chapters: drive the existing CSS reveal via .is-visible (toggleClass) so the
    // markup stays the single source of truth, plus a gentle parallax on each photo.
    gsap.utils.toArray('.chapter').forEach((ch) => {
      window.ScrollTrigger.create({
        trigger: ch,
        start: 'top 78%',
        onEnter: () => ch.classList.add('is-visible'),
      });
      const bg = ch.querySelector('.chapter-bg');
      if (bg) {
        gsap.fromTo(bg, { yPercent: -6 }, {
          yPercent: 6, ease: 'none',
          scrollTrigger: { trigger: ch, start: 'top bottom', end: 'bottom top', scrub: true },
        });
      }
    });

    window.ScrollTrigger.refresh();
  }

  // ---------- Init ----------
  function init() {
    initTopnav();
    initAccents();
    initStats();
    initChapterReveals();
    wireCrumb();
    handleRoute();
    window.addEventListener('hashchange', handleRoute);

    // Motion layer: prefer GSAP/ScrollTrigger when present and motion is allowed;
    // otherwise the rAF parallax fallback handles the photo movement. Chapter
    // reveals already work via IntersectionObserver regardless.
    if (!REDUCE_MOTION && typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined') {
      initGsap();
    } else {
      initParallaxFallback();
    }
    // v32: smart-place labels needs re-run on resize / orientation change.
    let resizeT;
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => {
        ['overviewStage', 'regionStage'].forEach((id) => {
          const s = document.getElementById(id);
          if (s && s.offsetParent !== null) smartPlaceLabels(s);
        });
      }, 120);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
