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
  function buildInkPin(name, opts) {
    const isRegion = opts && opts.kind === 'region';
    const drillable = opts && opts.drillable;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `ink-pin ${isRegion ? 'ink-pin-region' : 'ink-pin-spot'} ${drillable ? 'ink-pin-drill' : ''}`;
    el.innerHTML = `
      <span class="ink-pin-stem"></span>
      <span class="ink-pin-label">
        <span class="ink-pin-dot"></span>
        <span class="ink-pin-name">${escapeHTML(name)}</span>
      </span>`;
    return el;
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
      p.addEventListener('click', () => { location.hash = `#/map/${reg.id}`; });
      pins.appendChild(p);
    });
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
      p.addEventListener('click', () => { location.hash = `#/map/${regionId}/${sp.id}`; });
      pins.appendChild(p);
    });
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

  // ---------- Stats counter animation ----------
  function initStats() {
    const stats = document.querySelectorAll('[data-stat]');
    if (!stats.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          const counter = e.target.querySelector('[data-count]');
          if (counter && !counter.dataset.done) {
            animateCount(counter);
            counter.dataset.done = '1';
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

  // ---------- Story sections: reveal + parallax ----------
  function initStories() {
    const stories = document.querySelectorAll('.story');
    if (!stories.length) return;

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) e.target.classList.add('is-visible');
      });
    }, { threshold: 0.2 });
    stories.forEach((s) => io.observe(s));

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        stories.forEach((story) => {
          const rect = story.getBoundingClientRect();
          const vh = window.innerHeight;
          if (rect.bottom < -200 || rect.top > vh + 200) return;
          const centerOffset = (rect.top + rect.height / 2 - vh / 2) / (vh / 2);
          const bg = story.querySelector('.story-bg');
          if (bg) {
            const shift = -centerOffset * 28;
            const scale = 1.06 + Math.abs(centerOffset) * 0.03;
            bg.style.transform = `translate3d(0, ${shift}px, 0) scale(${scale.toFixed(3)})`;
          }
        });
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function initHero() {
    const hero = document.querySelector('.hero');
    if (!hero) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY || 0;
        const map = hero.querySelector('.hero-map');
        if (map) map.style.transform = `translate(-50%, calc(-50% + ${y * 0.18}px)) scale(${(1.05 + y * 0.00018).toFixed(4)})`;
        const content = hero.querySelector('.hero-content');
        if (content) content.style.transform = `translate3d(0, ${y * -0.25}px, 0)`;
        const fade = Math.max(0, 1 - y / 600);
        if (content) content.style.opacity = fade.toFixed(3);
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- Init ----------
  function init() {
    if (typeof L === 'undefined') {
      console.warn('Leaflet not loaded yet');
    }
    initTopnav();
    initStats();
    initStories();
    initHero();
    wireCrumb();
    handleRoute();
    window.addEventListener('hashchange', handleRoute);
    // v30: ink-map is purely image + abs-positioned pins — no resize handler needed.
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
