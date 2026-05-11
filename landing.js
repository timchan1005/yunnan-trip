/* ============================================================
   雲南之旅 · landing.js
   - Hash router (#/ landing, #/map hand-drawn overview)
   - Scroll observers (sticky reveal + parallax)
   - Hand-drawn map pin overlay
============================================================ */

(function () {
  'use strict';

  const DATA = window.DEFAULT_ITINERARY;
  if (!DATA) {
    console.warn('DEFAULT_ITINERARY data missing');
    return;
  }

  // ---------- Hand-drawn map: pin coordinates (normalized 0–1 over yn_hero_map.webp) ----------
  // The hero illustration roughly places landmarks at the following normalized positions
  // (origin top-left). I sampled these from the AI-generated image visually.
  // Tweak if the image is regenerated.
  const PIN_COORDS = {
    // city: { x, y }  — each pin maps loosely to its hand-drawn landmark on yn_hero_map.webp
    '昆明':       { x: 0.58, y: 0.81 },  // bottom-right red-roof cluster
    '石林':       { x: 0.78, y: 0.72 },  // karst pillars right of Kunming
    '撈魚河':     { x: 0.50, y: 0.83 },
    '大理':       { x: 0.32, y: 0.68 },  // Erhai lake area, left-center
    '雙廊':       { x: 0.36, y: 0.58 },  // upper Erhai
    '喜洲':       { x: 0.30, y: 0.60 },
    '崇聖寺':     { x: 0.33, y: 0.66 },
    '麗江':       { x: 0.40, y: 0.45 },  // ancient town center
    '玉龍雪山':   { x: 0.28, y: 0.32 },  // snow peak left of Lijiang
    '藍月谷':     { x: 0.27, y: 0.34 },
    '白沙':       { x: 0.36, y: 0.42 },
    '瀘沽湖':     { x: 0.66, y: 0.36 },  // emerald lake right
    '虎跳峽':     { x: 0.35, y: 0.40 },
    '香格里拉':   { x: 0.50, y: 0.22 },  // monastery cluster mid-top
    '松贊林寺':   { x: 0.48, y: 0.20 },
    '獨克宗':     { x: 0.51, y: 0.23 },
    '飛來寺':     { x: 0.42, y: 0.10 },  // meili snow mountains far north
    '梅里':       { x: 0.42, y: 0.08 },
    '普達措':     { x: 0.55, y: 0.25 },
    '納帕海':     { x: 0.46, y: 0.24 },
    '機場':       { x: 0.50, y: 0.22 }
  };

  // Map a day to its pin colour theme on the hand-drawn map
  function dayColorTheme(day) {
    if (day.city.includes('昆明')) return 'red';
    if (day.city.includes('大理')) return 'sunset';
    if (day.city.includes('麗江')) return 'jade';
    if (day.city.includes('瀘沽')) return 'indigo';
    if (day.city.includes('香格') || day.city.includes('德欽')) return 'indigo';
    return 'sunset';
  }

  // Find best pin coordinate for a spot by fuzzy keyword match
  function pinCoordFor(spot, day) {
    // First, try exact substring match against PIN_COORDS keys
    const name = spot.name || '';
    for (const key of Object.keys(PIN_COORDS)) {
      if (name.includes(key)) return PIN_COORDS[key];
    }
    // Fallback: use the day's city anchor
    const cityKey = (day.city || '').split(/[→\s]/)[0];
    if (PIN_COORDS[cityKey]) return PIN_COORDS[cityKey];
    return null;
  }

  // ---------- Router ----------
  const routes = {
    '/':    () => activateView('landing'),
    '/map': () => activateView('map')
  };

  function currentRoute() {
    const h = location.hash.replace(/^#/, '') || '/';
    if (h === '' || h === '/') return '/';
    if (h === '/map' || h === 'map') return '/map';
    return '/';
  }

  function activateView(name) {
    const landing = document.getElementById('view-landing');
    const map = document.getElementById('view-map');
    if (name === 'map') {
      landing.hidden = true;
      map.hidden = false;
      map.classList.add('is-active');
      // Initialise pins lazily on first map view
      if (!map.dataset.ready) {
        initMapView();
        map.dataset.ready = '1';
      }
      // Always scroll to top of map view
      window.scrollTo(0, 0);
    } else {
      map.hidden = true;
      map.classList.remove('is-active');
      landing.hidden = false;
    }
    // Update nav active state
    document.querySelectorAll('.navlinks a[data-route]').forEach((a) => {
      const r = a.getAttribute('data-route');
      a.classList.toggle('active', r === (name === 'map' ? '/map' : '/'));
    });
    // Update title
    document.title = name === 'map' ? '雲南手繪地圖 · 雲南之旅' : '雲南之旅 · 2026 秋';
  }

  function handleRoute() {
    const fn = routes[currentRoute()] || routes['/'];
    fn();
  }
  window.addEventListener('hashchange', handleRoute);

  // ---------- Top nav scroll state ----------
  function initTopnav() {
    const nav = document.getElementById('topnav');
    let last = 0;
    const onScroll = () => {
      const y = window.scrollY || 0;
      nav.classList.toggle('is-scrolled', y > 32);
      last = y;
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
      // ease-out-quart
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

    // Reveal observer
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) e.target.classList.add('is-visible');
      });
    }, { threshold: 0.2 });
    stories.forEach((s) => io.observe(s));

    // Parallax: shift bg based on scroll position
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    let ticking = false;
    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(() => {
          stories.forEach((story) => {
            const rect = story.getBoundingClientRect();
            const vh = window.innerHeight;
            if (rect.bottom < 0 || rect.top > vh) return;
            // -1 (top) to +1 (bottom), 0 at center
            const centerOffset = (rect.top + rect.height / 2 - vh / 2) / (vh / 2);
            const bg = story.querySelector('.story-bg');
            if (bg) {
              // Move bg up to 24px in either direction
              const shift = -centerOffset * 24;
              bg.style.transform = `scale(1.06) translate3d(0, ${shift}px, 0)`;
            }
          });
          ticking = false;
        });
        ticking = true;
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- Hero parallax on scroll ----------
  function initHero() {
    const map = document.querySelector('.hero-map');
    if (!map) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;
    let ticking = false;
    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(() => {
          const y = window.scrollY || 0;
          const shift = Math.min(y * 0.25, 200);
          map.style.transform = `translate(-50%, calc(-50% + ${shift}px)) scale(${1.05 + Math.min(y / 4000, 0.08)})`;
          ticking = false;
        });
        ticking = true;
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ---------- Map view: pins ----------
  function initMapView() {
    const pinsRoot = document.getElementById('mapPins');
    const dayList = document.getElementById('mapDayList');
    if (!pinsRoot || !dayList) return;

    // 1 pin per day for the hand-drawn overview (highest-value landmark of that day).
    // Falls back to first spot if no marquee landmark exists.
    const dayHighlights = DATA.days.map((day, idx) => {
      // pick the spot whose name matches a coord key best (skip airports/returns)
      let chosen = null;
      for (const s of day.spots) {
        if (/機場|返回|火車|站$/.test(s.name)) continue;
        const c = pinCoordFor(s, day);
        if (c) { chosen = { spot: s, coord: c }; break; }
      }
      // fallback: hotel coord or first spot using city anchor
      if (!chosen) {
        const c = pinCoordFor({ name: day.city }, day);
        if (c) chosen = { spot: day.spots[0] || { name: day.city, id: `day${day.day}-h` }, coord: c };
      }
      return {
        day, idx, chosen
      };
    });

    // Build pins
    pinsRoot.innerHTML = '';
    dayHighlights.forEach(({ day, idx, chosen }) => {
      if (!chosen) return;
      const theme = dayColorTheme(day);
      const pin = document.createElement('a');
      pin.className = 'map-pin';
      pin.setAttribute('data-color', theme);
      pin.style.left = (chosen.coord.x * 100) + '%';
      pin.style.top = (chosen.coord.y * 100) + '%';
      pin.href = `map.html?focus=${encodeURIComponent(chosen.spot.id || ('day' + day.day + '-s1'))}#day-${idx}`;
      pin.innerHTML = `
        <div class="map-pin-marker">
          <span class="map-pin-pulse" aria-hidden="true"></span>
          <span class="map-pin-bubble"><span class="map-pin-bubble-text">${day.day}</span></span>
        </div>
        <span class="map-pin-label">${escapeHTML(chosen.spot.name)}</span>
      `;
      pin.addEventListener('mouseenter', () => highlightDayRow(idx));
      pin.addEventListener('mouseleave', () => highlightDayRow(-1));
      pinsRoot.appendChild(pin);
    });

    // Build day list
    dayList.innerHTML = '';
    DATA.days.forEach((day, idx) => {
      const theme = dayColorTheme(day);
      const row = document.createElement('a');
      row.className = 'map-day-item';
      row.setAttribute('data-color', theme);
      row.setAttribute('data-day-idx', idx);
      // Link to interactive map focused on day
      row.href = `map.html?focus=day${day.day}#day-${idx}`;
      const spotsLabel = day.spots.length + ' 個景點';
      row.innerHTML = `
        <span class="map-day-num">${day.day}</span>
        <span class="map-day-info">
          <span class="map-day-name">${escapeHTML(day.city)}</span>
          <span class="map-day-meta">${escapeHTML(day.date)} · ${spotsLabel}</span>
        </span>
        <span class="map-day-arrow">›</span>
      `;
      row.addEventListener('mouseenter', () => highlightPin(idx));
      row.addEventListener('mouseleave', () => highlightPin(-1));
      dayList.appendChild(row);
    });

    function highlightDayRow(idx) {
      dayList.querySelectorAll('.map-day-item').forEach((el, i) => {
        el.classList.toggle('is-hover', i === idx);
      });
    }
    function highlightPin(idx) {
      pinsRoot.querySelectorAll('.map-pin').forEach((el, i) => {
        el.classList.toggle('is-active', i === idx);
      });
    }
  }

  function escapeHTML(s) {
    return String(s || '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );
  }

  // ---------- Init ----------
  function init() {
    initTopnav();
    initStats();
    initStories();
    initHero();
    handleRoute();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
