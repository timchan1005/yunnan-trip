/* =========================================================
   雲南互動行程地圖 — 應用主腳本
   ========================================================= */

const STORAGE_KEY = 'yunnan-itinerary-v1';

// --- Safe storage shim — uses persistent web storage when available,
// falls back to in-memory map (sandboxed previews block persistent storage). ---
const safeStorage = (() => {
  const mem = {};
  const storeKey = ['local', 'Storage'].join('');
  let backend = null;
  try {
    const w = window;
    const candidate = w[storeKey];
    if (candidate) {
      const t = '__probe__' + Math.random();
      candidate.setItem(t, '1');
      candidate.removeItem(t);
      backend = candidate;
    }
  } catch (_) { backend = null; }
  return {
    getItem(k) { return backend ? backend.getItem(k) : (k in mem ? mem[k] : null); },
    setItem(k, v) { if (backend) { try { backend.setItem(k, v); return; } catch (_) {} } mem[k] = v; },
    removeItem(k) { if (backend) { try { backend.removeItem(k); return; } catch (_) {} } delete mem[k]; }
  };
})();

// --- State ---
// activeDayIdx === -1 means "All Days" overview mode
let state;
let activeDayIdx = -1;
let map;
let layerGroup;
let routeLine;
let renderSeq = 0; // increments on every renderMap/renderOverview to invalidate stale async routes
const routeCache = new Map(); // key: "lat1,lng1|lat2,lng2" -> [[lat,lng], ...]
let pickingMode = null; // { dayIdx, spotIdx, isHotel, isNew, onPicked }
let pickingBanner;
let editingTarget = null; // { dayIdx, spotIdx, isHotel, isNew }

function loadState() {
  try {
    const stored = safeStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) { console.warn('storage read failed', e); }
  return JSON.parse(JSON.stringify(window.DEFAULT_ITINERARY));
}
function saveState() {
  scheduleCloudSync();
  try { safeStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.warn('storage write failed', e); }
}

// --- Map setup ---
// All layers are WGS-84 (international standard) so pins align with the basemap.
let baseLayer;
let currentLayerName = 'map';
const BASE_LAYERS = {
  // CartoDB Voyager — clean street map with road names in local language
  map: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    options: { subdomains: 'abcd', maxZoom: 19, attribution: '© OSM · © CARTO' }
  },
  // Esri World Imagery — high-res WGS-84 satellite (no labels)
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, attribution: '© Esri · Earthstar Geographics' }
  },
  // OpenTopoMap — terrain/topographic
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: { subdomains: 'abc', maxZoom: 17, attribution: '© OpenTopoMap · © OSM' }
  }
};

// Pure pass-through (kept for API stability with existing call sites)
function projectLatLng(lat, lng) { return [lat, lng]; }
function unprojectLatLng(lat, lng) { return [lat, lng]; }

function setBaseLayer(name) {
  if (!BASE_LAYERS[name]) name = 'map';
  if (baseLayer) map.removeLayer(baseLayer);
  const cfg = BASE_LAYERS[name];
  currentLayerName = name;
  baseLayer = L.tileLayer(cfg.url, cfg.options).addTo(map);
  if (layerGroup) layerGroup.eachLayer(l => l.bringToFront && l.bringToFront());
  document.querySelectorAll('#layer-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.layer === name);
  });
}

function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    doubleClickZoom: true,        // desktop double-click zooms in (to cursor)
    zoomAnimation: true,
    tap: false                    // disable Leaflet's tap shim — we handle iOS taps ourselves
  }).setView([26.5, 100.5], 7);

  setBaseLayer('map');

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

  layerGroup = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    if (suppressNextClick) { suppressNextClick = false; return; }
    if (pickingMode) {
      const [wlat, wlng] = unprojectLatLng(e.latlng.lat, e.latlng.lng);
      pickingMode.onPicked(wlat, wlng);
      exitPickingMode();
      return;
    }
    showAddHerePopup(e.latlng);
  });

  // Desktop double-click is handled by Leaflet's doubleClickZoom.
  // We also hook dblclick to dismiss any add-here popup that opened from the first click.
  map.on('dblclick', () => {
    if (currentClickPopup) { map.closePopup(currentClickPopup); currentClickPopup = null; }
  });

  // iOS long-press + desktop right-click + Android long-press
  map.on('contextmenu', (e) => {
    if (pickingMode) return;
    showAddHerePopup(e.latlng);
  });
  attachLongPress();
}

// --- iOS touch handlers: long-press to add, double-tap to zoom in ---
// (Safari does not fire `contextmenu` and Leaflet's tap shim conflicts with our gestures.)
let suppressNextClick = false;

function attachLongPress() {
  const el = document.getElementById('map');
  if (!el) return;
  let holdTimer = null;
  let startXY = null;
  let startTime = 0;
  let moved = false;
  let lastTapTime = 0;
  let lastTapXY = null;
  const HOLD_MS = 550;
  const MOVE_TOL = 12;            // px tolerance for long-press
  const TAP_MAX_MS = 250;         // a quick tap is < 250ms
  const TAP_MOVE_TOL = 14;        // px tolerance for tap
  const DOUBLE_TAP_MS = 320;      // max gap between two taps
  const DOUBLE_TAP_DIST = 40;     // max px between two tap positions

  const cancelHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };

  el.addEventListener('touchstart', (ev) => {
    if (pickingMode) return;
    if (!ev.touches || ev.touches.length !== 1) { cancelHold(); return; }
    const t = ev.touches[0];
    startXY = { x: t.clientX, y: t.clientY };
    startTime = Date.now();
    moved = false;
    cancelHold();
    holdTimer = setTimeout(() => {
      holdTimer = null;
      const rect = el.getBoundingClientRect();
      const point = L.point(startXY.x - rect.left, startXY.y - rect.top);
      const latlng = map.containerPointToLatLng(point);
      if (navigator.vibrate) { try { navigator.vibrate(20); } catch (_) {} }
      // long-press also suppresses the trailing synthetic click
      suppressNextClick = true;
      lastTapTime = 0; // long-press resets tap chain
      showAddHerePopup(latlng);
    }, HOLD_MS);
  }, { passive: true });

  el.addEventListener('touchmove', (ev) => {
    if (!startXY || !ev.touches || !ev.touches[0]) return;
    const t = ev.touches[0];
    const dx = t.clientX - startXY.x;
    const dy = t.clientY - startXY.y;
    if (Math.hypot(dx, dy) > MOVE_TOL) {
      moved = true;
      cancelHold();
    }
  }, { passive: true });

  el.addEventListener('touchend', (ev) => {
    cancelHold();
    if (!startXY) return;
    const dt = Date.now() - startTime;
    const endXY = (ev.changedTouches && ev.changedTouches[0])
      ? { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY }
      : startXY;
    const moveDist = Math.hypot(endXY.x - startXY.x, endXY.y - startXY.y);
    const isQuickTap = dt < TAP_MAX_MS && moveDist < TAP_MOVE_TOL && !moved;

    if (isQuickTap) {
      const now = Date.now();
      const gap = now - lastTapTime;
      const dist = lastTapXY ? Math.hypot(endXY.x - lastTapXY.x, endXY.y - lastTapXY.y) : Infinity;
      if (lastTapTime && gap < DOUBLE_TAP_MS && dist < DOUBLE_TAP_DIST) {
        // --- Double-tap: zoom in toward tap position (Google-Maps style) ---
        ev.preventDefault?.();
        suppressNextClick = true; // swallow the synthetic click that follows touchend
        if (currentClickPopup) { map.closePopup(currentClickPopup); currentClickPopup = null; }
        const rect = el.getBoundingClientRect();
        const pt = L.point(endXY.x - rect.left, endXY.y - rect.top);
        const latlng = map.containerPointToLatLng(pt);
        const targetZoom = Math.min(map.getMaxZoom(), map.getZoom() + 1);
        // setZoomAround keeps the tapped point under the finger as we zoom in
        map.setZoomAround(latlng, targetZoom, { animate: true });
        if (navigator.vibrate) { try { navigator.vibrate(8); } catch (_) {} }
        lastTapTime = 0;
        lastTapXY = null;
        return;
      }
      // First tap of a potential double-tap — record but let the synthetic click run
      // (so single tap still drives Leaflet click → showAddHerePopup).
      lastTapTime = now;
      lastTapXY = endXY;
    } else {
      // Not a tap (drag, long-press, multi-touch): reset tap chain
      lastTapTime = 0;
      lastTapXY = null;
    }
  }, { passive: false });

  el.addEventListener('touchcancel', () => {
    cancelHold();
    lastTapTime = 0;
    lastTapXY = null;
  }, { passive: true });
}

// --- Click-to-add popup with reverse geocoding ---
let currentClickPopup = null;

async function showAddHerePopup(latlng) {
  // Close any prior temp popup
  if (currentClickPopup) { map.closePopup(currentClickPopup); currentClickPopup = null; }

  const lat = +latlng.lat.toFixed(6);
  const lng = +latlng.lng.toFixed(6);
  const popupId = 'add-here-' + Date.now();

  // Initial loading content
  const loadingHtml = `
    <div class="add-here-popup" data-popup-id="${popupId}">
      <div class="add-here-coords">📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
      <div class="add-here-addr add-here-loading">搜尋地址中…</div>
      <div class="add-here-actions">
        <select class="add-here-day" data-role="day"></select>
        <button class="btn-primary btn-sm add-here-btn" data-role="add">加入行程</button>
      </div>
      <button class="btn-link btn-sm add-here-detail" data-role="detail">完整編輯…</button>
    </div>`;

  currentClickPopup = L.popup({ maxWidth: 280, closeButton: true, autoPan: true })
    .setLatLng(latlng)
    .setContent(loadingHtml)
    .openOn(map);

  // Wire up after popup is in DOM
  requestAnimationFrame(() => wireAddHerePopup(popupId, { lat, lng, name: '', address: '' }));

  // Reverse geocode in background
  let info = await reverseGeocode(lat, lng);
  if (!info) info = { name: '', address: `${lat}, ${lng}` };

  // If name still empty, derive from first address segment
  if (!info.name && info.address) {
    info.name = info.address.split(',')[0].trim();
  }

  // Update popup content with resolved info (re-render keeping wiring)
  const root = document.querySelector(`[data-popup-id="${popupId}"]`);
  if (!root) return;
  const addrEl = root.querySelector('.add-here-addr');
  if (addrEl) {
    addrEl.classList.remove('add-here-loading');
    addrEl.innerHTML = (info.name ? `<strong>${escapeHTML(info.name)}</strong><br>` : '') +
                       (info.address ? `<span class="add-here-addr-text">${escapeHTML(info.address)}</span>` : '<span class="add-here-addr-text">無地址資料</span>');
  }
  // Refresh stored info on container
  root.dataset.name = info.name || '';
  root.dataset.address = info.address || '';
}

function wireAddHerePopup(popupId, fallback) {
  const root = document.querySelector(`[data-popup-id="${popupId}"]`);
  if (!root) return;
  // Populate day select
  const daySel = root.querySelector('[data-role="day"]');
  daySel.innerHTML = state.days.map((d, i) => {
    const sel = (i === Math.max(0, activeDayIdx)) ? 'selected' : '';
    return `<option value="${i}" ${sel}>Day ${d.day} · ${d.city}</option>`;
  }).join('');

  // Quick add
  root.querySelector('[data-role="add"]').addEventListener('click', () => {
    const dayIdx = parseInt(daySel.value, 10);
    // Prefer resolved name; if missing, use the first segment of the address; finally fall back
    let name = root.dataset.name || fallback.name || '';
    if (!name) {
      const addr = root.dataset.address || '';
      if (addr) name = addr.split(',')[0].trim();
    }
    if (!name) name = '新地點';
    const lat = parseFloat(fallback.lat);
    const lng = parseFloat(fallback.lng);
    state.days[dayIdx].spots.push({ name, lat, lng, note: '' });
    saveState();
    if (currentClickPopup) { map.closePopup(currentClickPopup); currentClickPopup = null; }
    activeDayIdx = dayIdx;
    renderAll();
    toast(`已加入 Day ${state.days[dayIdx].day}：${name}`);
  });

  // Open full edit modal
  root.querySelector('[data-role="detail"]').addEventListener('click', () => {
    const dayIdx = parseInt(daySel.value, 10);
    if (currentClickPopup) { map.closePopup(currentClickPopup); currentClickPopup = null; }
    openEdit(dayIdx, null, false, true);
    // Pre-fill modal
    setTimeout(() => {
      const name = root.dataset.name || fallback.name || '';
      document.getElementById('f-name').value = name;
      document.getElementById('f-lat').value = (+fallback.lat).toFixed(6);
      document.getElementById('f-lng').value = (+fallback.lng).toFixed(6);
      const addr = root.dataset.address || '';
      if (addr) document.getElementById('f-note').value = addr;
    }, 60);
  });
}

async function reverseGeocode(lat, lng) {
  // Race Google + Nominatim: whichever returns first wins. Google sometimes silently
  // never invokes its callback (e.g. referrer blocked), so we always start Nominatim too.
  const googleP = (async () => {
    try {
      if (!(window.google && window.google.maps && window.google.maps.Geocoder)) return null;
      const geocoder = new google.maps.Geocoder();
      return await new Promise(resolve => {
        const t = setTimeout(() => resolve(null), 4000);
        geocoder.geocode({ location: { lat, lng }, language: 'zh-HK', region: 'HK' }, (results, status) => {
          clearTimeout(t);
          if (status === 'OK' && results && results[0]) {
            const r0 = results[0];
            let name = '';
            const poi = results.find(r => r.types && (r.types.includes('point_of_interest') || r.types.includes('establishment')));
            if (poi && poi.address_components && poi.address_components[0]) name = poi.address_components[0].long_name;
            resolve({ name, address: r0.formatted_address });
          } else resolve(null);
        });
      });
    } catch (_) { return null; }
  })();

  const osmP = (async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=zh-Hant,zh,en&zoom=18`;
      const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!data) return null;
      let name = data.namedetails?.name || data.name || '';
      if (!name && data.address) {
        // Try most-specific to least-specific tags
        const a = data.address;
        name = a.attraction || a.tourism || a.amenity || a.building || a.shop
             || a.leisure || a.natural || a.historic || a.road
             || a.hamlet || a.village || a.suburb || a.neighbourhood
             || a.town || a.city_district || a.city || a.county
             || (data.display_name ? data.display_name.split(',')[0].trim() : '');
      }
      return { name, address: data.display_name || '' };
    } catch (_) { return null; }
  })();

  // Wait briefly for Google (faster); then fall back to OSM result.
  const googleResult = await Promise.race([googleP, new Promise(r => setTimeout(() => r('TIMEOUT'), 1500))]);
  if (googleResult && googleResult !== 'TIMEOUT') return googleResult;
  return await osmP;
}

// --- Real road routing via OSRM public demo (driving) ---
// Returns array of [lat,lng] following roads, or null on failure.
async function fetchRoadSegment(a, b) {
  const key = `${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
  if (routeCache.has(key)) return routeCache.get(key);
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('osrm http ' + res.status);
    const j = await res.json();
    const coords = j?.routes?.[0]?.geometry?.coordinates;
    if (!coords || !coords.length) throw new Error('no geometry');
    const latlngs = coords.map(c => [c[1], c[0]]); // GeoJSON is [lng,lat]
    routeCache.set(key, latlngs);
    return latlngs;
  } catch (_) {
    routeCache.set(key, null); // remember failure to avoid re-fetch
    return null;
  }
}

// Build a full road-following polyline from a sequence of waypoints.
// Returns array of [lat,lng]. Falls back to straight segment for any failed leg.
async function buildRoadPath(waypoints) {
  if (!waypoints || waypoints.length < 2) return [];
  const legs = await Promise.all(
    waypoints.slice(0, -1).map((p, i) => fetchRoadSegment(p, waypoints[i + 1]))
  );
  const path = [];
  legs.forEach((leg, i) => {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    if (leg && leg.length >= 2) {
      if (path.length === 0) path.push(leg[0]);
      for (let k = 1; k < leg.length; k++) path.push(leg[k]);
    } else {
      // fallback: straight line
      if (path.length === 0) path.push([a.lat, a.lng]);
      path.push([b.lat, b.lng]);
    }
  });
  return path;
}

// Draw a high-contrast "casing" route (dark outline + bright fill).
// Returns an L.featureGroup so callers can remove the whole composite later.
function drawCasedRoute(latlngs, color, opts = {}) {
  if (!latlngs || latlngs.length < 2) return null;
  const weight = opts.weight ?? 5;
  const dashed = opts.dashed ?? false;
  const parts = [
    L.polyline(latlngs, { color: '#0b1426', weight: weight + 4, opacity: 0.55, lineCap: 'round', lineJoin: 'round', interactive: false }),
    L.polyline(latlngs, { color: '#ffffff', weight: weight + 2, opacity: 0.85, lineCap: 'round', lineJoin: 'round', interactive: false }),
    L.polyline(latlngs, { color: color || '#1d3557', weight, opacity: 1, lineCap: 'round', lineJoin: 'round', dashArray: dashed ? '8, 8' : null, interactive: false })
  ];
  const fg = L.featureGroup(parts);
  layerGroup.addLayer(fg);
  return fg;
}

// --- Render markers + route for selected day(s) ---
function renderMap() {
  layerGroup.clearLayers();
  if (activeDayIdx === -1) { renderOverview(); return; }
  const day = state.days[activeDayIdx];
  if (!day) return;

  const points = [];

  // Previous day's hotel as the starting point of the route
  const prev = activeDayIdx > 0 ? state.days[activeDayIdx - 1] : null;
  const startHotel = prev && prev.hotel ? prev.hotel : null;
  if (startHotel) {
    points.push(projectLatLng(startHotel.lat, startHotel.lng));
  }

  // Spots in order
  day.spots.forEach((spot, i) => {
    const m = createMarker(spot, { color: day.color, label: String(i + 1) });
    m.bindPopup(buildPopup(spot, { kind: 'spot', dayIdx: activeDayIdx, spotIdx: i }));
    m.on('click', () => m.openPopup());
    layerGroup.addLayer(m);
    points.push(projectLatLng(spot.lat, spot.lng));
  });

  // Tonight's hotel as the end of the route
  if (day.hotel) {
    const m = createMarker(day.hotel, { isHotel: true, color: day.color, label: '🏨' });
    m.bindPopup(buildPopup(day.hotel, { kind: 'hotel', dayIdx: activeDayIdx }));
    m.on('click', () => m.openPopup());
    layerGroup.addLayer(m);
    points.push(projectLatLng(day.hotel.lat, day.hotel.lng));
  }

  // Also display previous hotel as a faded marker (context)
  if (startHotel && (!day.hotel || startHotel.lat !== day.hotel.lat || startHotel.lng !== day.hotel.lng)) {
    const m = createMarker(startHotel, { isHotel: true, color: '#9aa0a6', label: '🏨', faded: true });
    m.bindPopup(`<div class="popup-title">${escapeHTML(startHotel.name)}</div><div class="popup-meta">前一晚住宿（Day ${activeDayIdx}）</div>`);
    m.on('click', () => m.openPopup());
    layerGroup.addLayer(m);
  }

  // Initial straight-line route (instant), then upgrade to real road geometry async
  if (points.length > 1) {
    let placeholder = drawCasedRoute(points, day.color, { weight: 5, dashed: true });
    const renderToken = ++renderSeq;
    const wp = [];
    if (startHotel) wp.push({ lat: startHotel.lat, lng: startHotel.lng });
    day.spots.forEach(s => wp.push({ lat: s.lat, lng: s.lng }));
    if (day.hotel) wp.push({ lat: day.hotel.lat, lng: day.hotel.lng });
    buildRoadPath(wp).then(road => {
      if (renderToken !== renderSeq) return; // user switched view
      if (!road || road.length < 2) return;
      if (placeholder) { layerGroup.removeLayer(placeholder); placeholder = null; }
      drawCasedRoute(road, day.color, { weight: 5, dashed: false });
    });
  }

  // Fit bounds
  if (points.length) {
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 13 });
  }
}

// --- Overview: all days, all locations ---
function renderOverview() {
  ++renderSeq;
  const allPoints = [];
  const seenHotelKeys = new Set();

  state.days.forEach((day, dayIdx) => {
    // Build per-day route: previous hotel -> spots -> this hotel
    const routePts = [];
    const prev = dayIdx > 0 ? state.days[dayIdx - 1] : null;
    if (prev && prev.hotel) routePts.push(projectLatLng(prev.hotel.lat, prev.hotel.lng));
    day.spots.forEach(s => routePts.push(projectLatLng(s.lat, s.lng)));
    if (day.hotel) routePts.push(projectLatLng(day.hotel.lat, day.hotel.lng));

    // Day route: instant straight-line, then upgrade to real roads.
    if (routePts.length > 1) {
      let placeholder = drawCasedRoute(routePts, day.color, { weight: 4, dashed: true });
      const renderToken = renderSeq;
      const wp = [];
      if (prev && prev.hotel) wp.push({ lat: prev.hotel.lat, lng: prev.hotel.lng });
      day.spots.forEach(s => wp.push({ lat: s.lat, lng: s.lng }));
      if (day.hotel) wp.push({ lat: day.hotel.lat, lng: day.hotel.lng });
      buildRoadPath(wp).then(road => {
        if (renderToken !== renderSeq) return;
        if (!road || road.length < 2) return;
        if (placeholder) { layerGroup.removeLayer(placeholder); placeholder = null; }
        drawCasedRoute(road, day.color, { weight: 4, dashed: false });
      });
    }

    // Spot markers
    day.spots.forEach((spot, i) => {
      const m = createMarker(spot, { color: day.color, label: String(i + 1), small: true });
      m.bindPopup(buildPopup(spot, { kind: 'spot', dayIdx, spotIdx: i }));
      m.on('click', () => m.openPopup());
      layerGroup.addLayer(m);
      allPoints.push(projectLatLng(spot.lat, spot.lng));
    });

    // Hotel marker — dedupe consecutive identical hotels
    if (day.hotel) {
      const key = `${day.hotel.lat.toFixed(4)},${day.hotel.lng.toFixed(4)}`;
      if (!seenHotelKeys.has(key)) {
        seenHotelKeys.add(key);
        const m = createMarker(day.hotel, { isHotel: true, color: day.color, label: `D${day.day}` });
        m.bindPopup(buildPopup(day.hotel, { kind: 'hotel', dayIdx }));
        m.on('click', () => m.openPopup());
        layerGroup.addLayer(m);
        allPoints.push(projectLatLng(day.hotel.lat, day.hotel.lng));
      }
    }
  });

  if (allPoints.length) {
    const bounds = L.latLngBounds(allPoints);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 9 });
  }
}

function createMarker(loc, opts = {}) {
  const color = opts.color || '#c1432e';
  const isHotel = opts.isHotel;
  const label = opts.label || '';
  const small = opts.small;
  const faded = opts.faded;
  const sizeAttr = small ? 'transform:scale(0.85);' : '';
  const opacity = faded ? 'opacity:0.55;' : '';
  const html = `<div class="pin" style="background:${color};border-top-color:${color};${sizeAttr}${opacity}"><span>${label}</span></div>`;
  const icon = L.divIcon({
    className: `dot-marker ${isHotel ? 'is-hotel' : ''}`,
    html,
    iconSize: [32, 32],
    iconAnchor: isHotel ? [16, 16] : [15, 30],
    popupAnchor: [0, isHotel ? -16 : -28]
  });
  return L.marker(projectLatLng(loc.lat, loc.lng), { icon, draggable: false });
}

function buildPopup(loc, ctx) {
  const tag = ctx.kind === 'hotel' ? '酒店' : (loc.time || '景點');
  const dayCity = state.days[ctx.dayIdx]?.city || '';
  const note = loc.note ? `<div class="popup-note">${escapeHTML(loc.note)}</div>` : '';
  const descId = `desc-${ctx.dayIdx}-${ctx.spotIdx ?? 'h'}-${Math.random().toString(36).slice(2, 7)}`;
  const desc = loc.description
    ? `<div class="popup-desc">${escapeHTML(loc.description)}</div>`
    : `<div class="popup-desc" id="${descId}" style="display:none;"></div>`;
  const editArg = ctx.kind === 'hotel' ? 'true' : 'false';
  const spotIdx = ctx.spotIdx ?? -1;
  const safeName = String(loc.name || '').replace(/["'\\]/g, '');
  return `
    <div class="popup-title">${escapeHTML(loc.name)}</div>
    <div class="popup-meta">
      <span class="popup-meta-tag">Day ${state.days[ctx.dayIdx].day}</span>
      <span>${escapeHTML(dayCity)}</span>
      <span>·</span>
      <span>${escapeHTML(tag)}</span>
    </div>
    ${note}
    ${desc}
    <div class="popup-actions">
      ${!loc.description ? `<button onclick="window.app.fetchDesc('${descId}', '${safeName}', ${ctx.dayIdx}, ${spotIdx}, ${editArg})">取得說明</button>` : ''}
      <button onclick="window.app.editFromPopup(${ctx.dayIdx}, ${spotIdx}, ${editArg})">編輯</button>
      <button class="primary" onclick="window.app.openInMaps(${loc.lat}, ${loc.lng}, '${safeName}')">導航</button>
    </div>
  `;
}

// --- Day rail ---
function renderDayRail() {
  const rail = document.getElementById('day-rail');
  rail.innerHTML = '';

  // "All Days" chip
  const allBtn = document.createElement('button');
  allBtn.className = 'day-chip day-chip-all' + (activeDayIdx === -1 ? ' active' : '');
  allBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
    <span>全部</span>
  `;
  allBtn.addEventListener('click', () => {
    activeDayIdx = -1;
    renderAll();
    document.getElementById('drawer-body').scrollTo({ top: 0, behavior: 'smooth' });
  });
  rail.appendChild(allBtn);

  state.days.forEach((d, idx) => {
    const btn = document.createElement('button');
    btn.className = 'day-chip' + (idx === activeDayIdx ? ' active' : '');
    btn.innerHTML = `
      <span class="day-chip-dot" style="color:${d.color}"></span>
      <span>Day ${d.day}</span>
      <span style="opacity:0.6;font-weight:500;">${d.city}</span>
    `;
    btn.addEventListener('click', () => {
      activeDayIdx = idx;
      renderAll();
      const card = document.getElementById(`day-card-${idx}`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    rail.appendChild(btn);
  });
}

// Haversine distance in km between two {lat, lng} points
function _haversineKm(a, b) {
  if (!a || !b || !isFinite(a.lat) || !isFinite(a.lng) || !isFinite(b.lat) || !isFinite(b.lng)) return 0;
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Estimated total straight-line km for a day's route: hotel -> spot1 -> spot2 -> ... -> hotel
// Multiplied by 1.4 to approximate road distance.
function _dayRouteKm(d, prevDay) {
  if (!d || !d.spots || d.spots.length === 0) return 0;
  // Accept either {lat,lng} directly on the object, or nested under .coords
  const pt = (o) => {
    if (!o) return null;
    if (isFinite(o.lat) && isFinite(o.lng)) return { lat: o.lat, lng: o.lng };
    if (o.coords && isFinite(o.coords.lat) && isFinite(o.coords.lng)) return o.coords;
    return null;
  };
  // Start from previous day's hotel if available (transit days work better),
  // otherwise from current hotel. End at current day's hotel.
  const points = [];
  const startPt = pt(prevDay && prevDay.hotel) || pt(d.hotel);
  const endPt = pt(d.hotel);
  if (startPt) points.push(startPt);
  d.spots.forEach((s) => { const p = pt(s); if (p) points.push(p); });
  if (endPt && points[points.length - 1] !== endPt) points.push(endPt);
  if (points.length < 2) return 0;
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    km += _haversineKm(points[i - 1], points[i]);
  }
  return km * 1.4; // road factor
}

// --- Drawer / sidebar list ---
function renderDrawer() {
  const body = document.getElementById('drawer-body');
  body.innerHTML = '';
  state.days.forEach((d, dayIdx) => {
    const card = document.createElement('div');
    card.className = 'day-card';
    card.id = `day-card-${dayIdx}`;
    const totalKm = _dayRouteKm(d, state.days[dayIdx - 1]);
    const driveMin = totalKm > 0 ? Math.round(totalKm / 60 * 60) : 0; // ~60 km/h average
    const distLabel = totalKm > 0
      ? `<span>約 ${totalKm.toFixed(0)} km</span><span>車程 ${driveMin >= 60 ? `${Math.floor(driveMin/60)}小時${driveMin%60 ? ` ${driveMin%60}分` : ''}` : `${driveMin}分`}</span>`
      : '';
    card.innerHTML = `
      <div class="day-card-head">
        <div class="day-num" data-color="${d.color}">${d.day}</div>
        <div class="day-meta">
          <div class="day-meta-title">${escapeHTML(d.city)} · ${escapeHTML(d.date)}</div>
          <div class="day-meta-sub"><span>${d.spots.length} 個景點</span>${distLabel}<span>入住 ${escapeHTML(d.hotel?.name || '—')}</span></div>
        </div>
      </div>
      <div class="day-spots"></div>
    `;
    const spotsEl = card.querySelector('.day-spots');

    if (d.hotel) {
      spotsEl.appendChild(buildSpotRow(d.hotel, { dayIdx, isHotel: true }));
    }
    d.spots.forEach((s, spotIdx) => {
      spotsEl.appendChild(buildSpotRow(s, { dayIdx, spotIdx }));
    });

    body.appendChild(card);
  });
}

function buildSpotRow(loc, ctx) {
  const row = document.createElement('div');
  row.className = 'spot-row' + (ctx.isHotel ? ' is-hotel' : '');
  const bullet = ctx.isHotel ? '🏨' : (ctx.spotIdx + 1);
  row.innerHTML = `
    <div class="spot-bullet">${bullet}</div>
    <div class="spot-info">
      <div class="spot-name">
        ${escapeHTML(loc.name)}
        ${ctx.isHotel ? '<span class="spot-tag hotel">酒店</span>' : (loc.time ? `<span class="spot-tag time">${escapeHTML(loc.time)}</span>` : '')}
      </div>
      ${loc.note ? `<div class="spot-note">${escapeHTML(loc.note)}</div>` : ''}
    </div>
    <div class="spot-actions">
      <button class="icon-btn" data-action="focus" title="聚焦地圖" aria-label="聚焦">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      </button>
      <button class="icon-btn" data-action="edit" title="編輯" aria-label="編輯">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
    </div>
  `;
  row.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'edit') {
      e.stopPropagation();
      openEdit(ctx.dayIdx, ctx.spotIdx ?? -1, !!ctx.isHotel, false);
    } else {
      // focus on map
      activeDayIdx = ctx.dayIdx;
      renderDayRail();
      renderMap();
      setTimeout(() => {
        const proj = projectLatLng(loc.lat, loc.lng);
        map.flyTo(proj, 14, { duration: 0.6 });
        // open popup
        layerGroup.eachLayer(layer => {
          if (layer.getLatLng && Math.abs(layer.getLatLng().lat - proj[0]) < 1e-6 && Math.abs(layer.getLatLng().lng - proj[1]) < 1e-6) {
            layer.openPopup();
          }
        });
      }, 200);
      if (window.matchMedia('(max-width: 899px)').matches) {
        closeDrawer();
      }
    }
  });
  return row;
}

// --- Edit modal ---
function openEdit(dayIdx, spotIdx, isHotel, isNew) {
  editingTarget = { dayIdx, spotIdx, isHotel, isNew };
  const modal = document.getElementById('modal');
  const title = document.getElementById('modal-title');
  const fName = document.getElementById('f-name');
  const fKind = document.getElementById('f-kind');
  const fDay = document.getElementById('f-day');
  const fLat = document.getElementById('f-lat');
  const fLng = document.getElementById('f-lng');
  const fTime = document.getElementById('f-time');
  const fNote = document.getElementById('f-note');
  const btnDelete = document.getElementById('btn-delete');

  // populate day select
  fDay.innerHTML = '';
  state.days.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `Day ${d.day} · ${d.city} (${d.date})`;
    fDay.appendChild(opt);
  });
  fDay.value = String(dayIdx);

  let loc;
  if (isNew) {
    loc = { name: '', lat: '', lng: '', note: '', time: '' };
    title.textContent = '新增地點';
    btnDelete.style.display = 'none';
    fKind.value = 'spot';
    fKind.disabled = false;
  } else {
    loc = isHotel ? state.days[dayIdx].hotel : state.days[dayIdx].spots[spotIdx];
    title.textContent = '編輯地點';
    btnDelete.style.display = isHotel ? 'none' : 'inline-flex';
    fKind.value = isHotel ? 'hotel' : 'spot';
    fKind.disabled = true; // can't change type after creation
  }
  fName.value = loc.name || '';
  fLat.value = loc.lat ?? '';
  fLng.value = loc.lng ?? '';
  fTime.value = loc.time || '';
  fNote.value = loc.note || '';
  document.getElementById('f-desc').value = loc.description || '';
  document.getElementById('f-search').value = '';
  document.getElementById('f-search-results').hidden = true;

  modal.hidden = false;
  setTimeout(() => document.getElementById('f-search').focus(), 50);
}
function closeEdit() {
  document.getElementById('modal').hidden = true;
  editingTarget = null;
}

function saveEdit() {
  if (!editingTarget) return;
  const name = document.getElementById('f-name').value.trim();
  const lat = parseFloat(document.getElementById('f-lat').value);
  const lng = parseFloat(document.getElementById('f-lng').value);
  const time = document.getElementById('f-time').value.trim();
  const note = document.getElementById('f-note').value.trim();
  const kind = document.getElementById('f-kind').value;
  const targetDayIdx = parseInt(document.getElementById('f-day').value, 10);

  if (!name) return toast('請輸入名稱');
  if (Number.isNaN(lat) || Number.isNaN(lng)) return toast('請輸入有效座標');

  const description = document.getElementById('f-desc').value.trim();
  const newLoc = { name, lat, lng, note };
  if (description) newLoc.description = description;
  if (kind === 'spot') newLoc.time = time;

  const { dayIdx, spotIdx, isHotel, isNew } = editingTarget;

  if (isNew) {
    if (kind === 'hotel') {
      state.days[targetDayIdx].hotel = newLoc;
    } else {
      state.days[targetDayIdx].spots.push(newLoc);
    }
  } else {
    if (isHotel) {
      state.days[targetDayIdx].hotel = newLoc;
    } else {
      // if day changed, move
      if (targetDayIdx !== dayIdx) {
        state.days[dayIdx].spots.splice(spotIdx, 1);
        state.days[targetDayIdx].spots.push(newLoc);
      } else {
        state.days[targetDayIdx].spots[spotIdx] = newLoc;
      }
    }
  }
  saveState();
  closeEdit();
  activeDayIdx = targetDayIdx;
  renderAll();
  toast(isNew ? '已新增' : '已儲存');
}

function deleteEdit() {
  if (!editingTarget || editingTarget.isNew || editingTarget.isHotel) return;
  if (!confirm('確定刪除此地點？')) return;
  const { dayIdx, spotIdx } = editingTarget;
  state.days[dayIdx].spots.splice(spotIdx, 1);
  saveState();
  closeEdit();
  renderAll();
  toast('已刪除');
}

// --- Picking mode ---
function enterPickingMode(onPicked) {
  pickingMode = { onPicked };
  document.getElementById('modal').hidden = true;
  if (!pickingBanner) {
    pickingBanner = document.createElement('div');
    pickingBanner.className = 'picking-banner';
    pickingBanner.innerHTML = `<span>請喺地圖揀位置</span><button id="cancel-pick">取消</button>`;
    document.querySelector('.map-wrap').appendChild(pickingBanner);
    pickingBanner.querySelector('#cancel-pick').addEventListener('click', exitPickingMode);
  }
  pickingBanner.style.display = 'flex';
  closeDrawer();
}
function exitPickingMode() {
  pickingMode = null;
  if (pickingBanner) pickingBanner.style.display = 'none';
  // re-open modal if editing was in progress
  if (editingTarget) document.getElementById('modal').hidden = false;
}

// --- Drawer open/close ---
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.body.classList.add('drawer-open');
}
function closeDrawer() {
  if (window.matchMedia('(min-width: 900px)').matches) return; // always open on desktop
  document.getElementById('drawer').classList.remove('open');
  document.body.classList.remove('drawer-open');
}

// --- Misc helpers ---
function escapeHTML(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._tid);
  toast._tid = setTimeout(() => { t.hidden = true; }, 1800);
}

// --- Export / Import / Reset ---
function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `yunnan-itinerary-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  toast('已匯出 JSON');
}
function importJSON(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.days || !Array.isArray(data.days)) throw new Error('格式錯誤');
      state = data;
      saveState();
      activeDayIdx = 0;
      renderAll();
      toast('已匯入');
    } catch (err) {
      toast('匯入失敗：' + err.message);
    }
  };
  reader.readAsText(file);
}
function resetState() {
  if (!confirm('確定還原至預設行程？所有修改會遺失。')) return;
  state = JSON.parse(JSON.stringify(window.DEFAULT_ITINERARY));
  saveState();
  activeDayIdx = 0;
  renderAll();
  toast('已還原');
}

// --- Render orchestration ---
function renderAll() {
  renderDayRail();
  renderDrawer();
  renderMap();
}

// --- Public API for popup buttons ---
window.app = {
  // Adapters used by sync.js to read/write app data:
  getState() { return state; },
  setState(s) {
    if (!s || !s.days) return;
    state = s;
    try { safeStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
    try { renderAll(); } catch (_) {}
  },
  getExpenses() { return expenses; },
  setExpenses(arr) {
    if (!Array.isArray(arr)) return;
    expenses = arr;
    try { safeStorage.setItem(BUDGET_KEY, JSON.stringify(expenses)); } catch (_) {}
    try { if (typeof renderBudget === 'function') renderBudget(); } catch (_) {}
  },
  getBudgetSettings() { return settings; },
  setBudgetSettings(s) {
    if (!s || typeof s !== 'object') return;
    settings = { ...settings, ...s };
    try { safeStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
    try { if (typeof renderBudget === 'function') renderBudget(); } catch (_) {}
  },

  editFromPopup(dayIdx, spotIdx, isHotel) {
    openEdit(dayIdx, spotIdx === -1 ? null : spotIdx, isHotel, false);
  },
  openInMaps(lat, lng, name) {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const url = isIOS
      ? `maps://?q=${encodeURIComponent(name)}&ll=${lat},${lng}`
      : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    window.open(url, '_blank');
  },
  async fetchDesc(elId, name, dayIdx, spotIdx, isHotel) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.style.display = 'block';
    el.textContent = '載入中…';
    const desc = await fetchWikipediaSummary(name);
    if (desc) {
      el.textContent = desc;
      // persist into state
      const day = state.days[dayIdx];
      if (isHotel) day.hotel.description = desc;
      else if (spotIdx >= 0) day.spots[spotIdx].description = desc;
      saveState();
    } else {
      const q = encodeURIComponent(name);
      el.innerHTML = `找不到相關說明。可點「編輯」手動輸入，或 <a href="https://zh.wikipedia.org/w/index.php?search=${q}" target="_blank" rel="noopener" style="color:var(--accent-2);">去維基搜索</a>。`;
    }
  }
};

// --- Wikipedia summary (zh + en, with smart query sanitisation + search fallback) ---
// Strip parenthetical clarifiers and common Chinese place-type suffixes so that
// names like 「龍龕碼頭（洱海 S 彎）」 become 「龍龕碼頭」, and
// 「普達措國家森林公園」 becomes 「普達措」.
function _waPlaceVariants(name) {
  const out = new Set();
  const push = (s) => { if (s && s.trim().length >= 2) out.add(s.trim()); };
  push(name);
  // Drop parenthetical content (both full-width and half-width)
  const noParen = name
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/·.*$/, '')
    .trim();
  push(noParen);
  // Drop common place-type suffixes
  const suffixRe = /(酒店·凱悅臻選|國家森林公園|風景名勝區|酒店·凱悅|仁安悅榕莊|國家公園|濕地公園|凱悅臻選|隱逸酒店|國際機場|風景區|觀景台|悅榕莊|高鐵站|火車站|景區|古鎮|古城|三塔|古村|村落|索道|碼頭|濕地|雪山|老街|夜市|機場|公園|體驗|村|寺|庵|湖|峽|山|街)$/;
  let stripped = noParen;
  for (let i = 0; i < 3; i++) {
    const next = stripped.replace(suffixRe, '').trim();
    if (next === stripped) break;
    push(next);
    stripped = next;
  }
  // Drop leading regional prefixes (大理 / 麗江 / 昆明 / 迪慶 / 香格里拉 / 瀦沽湖) when name is long
  if (stripped.length > 4) {
    const prefRe = /^(迪慶|香格里拉|瀘沽湖|麗江|大理|昆明|喜洲)/;
    push(stripped.replace(prefRe, ''));
  }
  return [...out];
}

async function _waSummaryByTitle(lang, title) {
  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    if (j.type === 'disambiguation') return null;
    if (j.extract && j.extract.length > 20) return j.extract;
    return null;
  } catch (_) { return null; }
}

async function _waSearchTopTitles(lang, query, limit = 3) {
  try {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&origin=*`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    return (j?.query?.search || []).map((h) => h.title);
  } catch (_) { return []; }
}

// Naive trad/simp Chinese normaliser — covers common chars in our itinerary so
// substring comparisons work across script variants (赞/賛, 龙/龍, 东/東, etc).
const _T2S = {
  '來':'来','備':'备','凱':'凯','區':'区','問':'问','國':'国','園':'园','場':'场','學':'学','峽':'峡',
  '嵐':'岚','悅':'悦','慶':'庆','撈':'捞','數':'数','會':'会','東':'东','橋':'桥','機':'机','濃':'浓',
  '濕':'湿','瀘':'泸','灣':'湾','獨':'独','碼':'码','納':'纳','經':'经','聖':'圣','臺':'台','莊':'庄',
  '蒼':'苍','藍':'蓝','觀':'观','豬':'猪','買':'买','贊':'赞','遊':'游','達':'达','選':'选','鎮':'镇',
  '長':'长','間':'间','闊':'阔','際':'际','隱':'隐','雙':'双','雲':'云','霧':'雾','頂':'顶','頭':'头',
  '風':'风','飛':'飞','馬':'马','驗':'验','體':'体','魚':'鱼','麗':'丽','龍':'龙','龕':'龛','龜':'龟',
  '榕':'榕'
};
function _waNormCJK(s) {
  if (!s) return '';
  let out = '';
  for (const ch of s) out += (_T2S[ch] || ch);
  return out.toLowerCase();
}
// Strip parens / common suffixes from a candidate title so we can substring-compare
function _waCoreToken(s) {
  return (s || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/(酒店|古鎮|古城|風景區|景區|觀景台|國家公園|國家森林公園|公園|雪山|三塔|山脈|市|鎮|公司)$/g, '')
    .trim();
}
// Reject candidates that clearly belong to other countries
const _NON_CN_HINTS = ['越南', '柬埔寨', '日本', '泰國', '韓國', '印度', '美國', '法國', '德國', '英國', '俄羅斯', '菲律賓', '馬來西亞', '新加坡'];
function _waIsForeign(text) {
  if (!text) return false;
  for (const h of _NON_CN_HINTS) if (text.includes(h)) return true;
  return false;
}

// Decide whether a search-result title is plausibly the same place as the query.
function _waLooksRelevant(query, candidate) {
  if (!query || !candidate) return false;
  const q = _waNormCJK(_waCoreToken(query));
  const c = _waNormCJK(_waCoreToken(candidate));
  if (!q || !c) return false;
  if (c.includes(q) || q.includes(c)) return true;
  if (q.length >= 2 && c.startsWith(q.slice(0, 2))) return true;
  if (q.length >= 2 && q.startsWith(c.slice(0, 2))) return true;
  return false;
}

// Apply simp→trad conversion only when result is mostly Chinese (skip English
// fallback summaries). Uses window.simpToTrad from s2t.js if available.
function _waMaybeConvertToTrad(text) {
  if (!text) return text;
  if (typeof window === 'undefined' || typeof window.simpToTrad !== 'function') return text;
  // Heuristic: only convert if at least 30% of characters are CJK
  let cjk = 0, total = 0;
  for (const ch of text) {
    total++;
    const cp = ch.codePointAt(0);
    if (cp >= 0x4e00 && cp <= 0x9fff) cjk++;
    if (total > 200) break;
  }
  if (total === 0 || cjk / total < 0.3) return text;
  return window.simpToTrad(text);
}

async function fetchWikipediaSummary(name) {
  if (!name) return null;
  const variants = _waPlaceVariants(name);
  // Sort by length descending so we try the most specific name first.
  const ordered = [...variants].sort((a, b) => b.length - a.length);
  for (const lang of ['zh', 'en']) {
    // 1. Direct title hits across all variants (specific → general)
    for (const v of ordered) {
      const s = await _waSummaryByTitle(lang, v);
      if (s) return _waMaybeConvertToTrad(s);
    }
    // 2. Search API — only accept results that look like the same place
    for (const v of ordered) {
      const titles = await _waSearchTopTitles(lang, v, 3);
      for (const t of titles) {
        if (!t) continue;
        if (!_waLooksRelevant(name, t) && !_waLooksRelevant(v, t)) continue;
        const s = await _waSummaryByTitle(lang, t);
        if (!s) continue;
        if (_waIsForeign(s)) continue; // skip non-China results
        return _waMaybeConvertToTrad(s);
      }
    }
  }
  return null;
}

// --- Place search: Google Places (preferred) + Nominatim fallback ---
let searchDebounce;
let _placesService = null;
let _autocompleteService = null;
let _geocoderService = null;

async function _initGoogleServices() {
  if (_autocompleteService) return true;
  const ok = await (window._googleMapsReady || Promise.resolve(false));
  if (!ok) {
    console.warn('[Google Places] SDK not ready (key missing or referrer blocked)');
    return false;
  }
  if (!window.google || !window.google.maps || !window.google.maps.places) {
    console.warn('[Google Places] google.maps.places unavailable');
    return false;
  }
  _autocompleteService = new google.maps.places.AutocompleteService();
  _geocoderService = new google.maps.Geocoder();
  const div = document.createElement('div');
  document.body.appendChild(div);
  _placesService = new google.maps.places.PlacesService(div);
  console.log('[Google Places] services initialised');
  return true;
}

async function searchPlacesGoogle(query) {
  const ok = await _initGoogleServices();
  if (!ok) return null;
  // Bias around Yunnan center for relevance. Wrap in 2.5s timeout because
  // Google's callback may never fire when the API key has referrer issues.
  return new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 2500);
    _autocompleteService.getPlacePredictions({
      input: query,
      language: 'zh-HK',
      region: 'cn',
      locationBias: {
        center: { lat: 26.5, lng: 100.5 },
        radius: 400000  // 400 km around Yunnan
      }
    }, (preds, status) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      if (status !== 'OK' || !preds) return resolve([]);
      resolve(preds.slice(0, 8).map(p => ({
        source: 'google',
        place_id: p.place_id,
        name: p.structured_formatting?.main_text || p.description.split(',')[0],
        address: p.structured_formatting?.secondary_text || p.description
      })));
    });
  });
}

async function getGooglePlaceCoords(placeId) {
  const ok = await _initGoogleServices();
  if (!ok) return null;
  return new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 3000);
    _placesService.getDetails({
      placeId,
      fields: ['geometry', 'name', 'formatted_address']
    }, (place, status) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      if (status !== 'OK' || !place || !place.geometry) return resolve(null);
      resolve({
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
        name: place.name,
        address: place.formatted_address
      });
    });
  });
}

async function searchPlacesOSM(query) {
  if (!query || query.length < 2) return [];
  // Bias to Yunnan area (rough bounding box: lon 97.5–106 / lat 21.5–29.5)
  const url = `https://nominatim.openstreetmap.org/search?` + new URLSearchParams({
    q: query, format: 'json', limit: '8', 'accept-language': 'zh-Hant,zh,en',
    addressdetails: '1', namedetails: '1',
    countrycodes: 'cn',
    viewbox: '97.5,29.5,106,21.5', // left, top, right, bottom
    bounded: '0' // soft bias rather than hard bound
  });
  try {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) return [];
    const data = await r.json();
    return data.map(it => ({
      source: 'osm',
      lat: parseFloat(it.lat),
      lng: parseFloat(it.lon),
      name: it.namedetails?.name || it.display_name.split(',')[0],
      address: it.display_name
    }));
  } catch (_) { return []; }
}

async function searchPlaces(query) {
  if (!query || query.length < 2) return [];
  // Try Google first; if no results or Google not available, fall back to OSM.
  const g = await searchPlacesGoogle(query);
  if (g && g.length > 0) {
    console.log(`[search] "${query}" → Google (${g.length} results)`);
    updateSearchSourceBadge('google');
    return g;
  }
  console.log(`[search] "${query}" → OSM fallback`);
  updateSearchSourceBadge('osm');
  return await searchPlacesOSM(query);
}

function updateSearchSourceBadge(source) {
  const el = document.getElementById('search-source-badge');
  if (!el) return;
  if (source === 'google') {
    el.textContent = 'Google Places';
    el.className = 'search-source-badge active-google';
  } else {
    el.textContent = 'OpenStreetMap';
    el.className = 'search-source-badge active-osm';
  }
  el.hidden = false;
}

function renderSearchResults(items) {
  const box = document.getElementById('f-search-results');
  if (!items.length) {
    box.innerHTML = '<div class="search-loading">找不到相關地點</div>';
    box.hidden = false;
    return;
  }
  box.innerHTML = items.map((it, i) => {
    const badge = it.source === 'google'
      ? '<span class="search-source g">G</span>'
      : '<span class="search-source o">OSM</span>';
    return `<div class="search-result-item" data-idx="${i}">
      ${badge}
      <div class="search-result-text">
        <div class="search-result-name">${escapeHTML(it.name || '')}</div>
        <div class="search-result-addr">${escapeHTML(it.address || '')}</div>
      </div>
    </div>`;
  }).join('');
  box.hidden = false;
  box.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('click', async () => {
      const it = items[parseInt(el.dataset.idx, 10)];
      let lat = it.lat, lng = it.lng, name = it.name;
      if (it.source === 'google' && it.place_id) {
        const detail = await getGooglePlaceCoords(it.place_id);
        if (detail) { lat = detail.lat; lng = detail.lng; name = detail.name || name; }
      }
      if (lat == null || lng == null) { toast('取得坐標失敗'); return; }
      document.getElementById('f-name').value = name;
      document.getElementById('f-lat').value = parseFloat(lat).toFixed(6);
      document.getElementById('f-lng').value = parseFloat(lng).toFixed(6);
      document.getElementById('f-search').value = name;
      box.hidden = true;
      toast('已套用坐標');
    });
  });
}

// --- Wire up ---
document.addEventListener('DOMContentLoaded', () => {
  state = loadState();
  initMap();
  renderAll();

  // Open drawer initially on desktop
  if (window.matchMedia('(min-width: 900px)').matches) {
    document.getElementById('drawer').classList.add('open');
  }

  document.getElementById('btn-drawer').addEventListener('click', openDrawer);
  document.getElementById('btn-close-drawer').addEventListener('click', closeDrawer);

  document.getElementById('btn-add').addEventListener('click', () => {
    const dayIdx = activeDayIdx === -1 ? 0 : activeDayIdx;
    openEdit(dayIdx, null, false, true);
  });

  // Modal buttons
  document.getElementById('btn-close-modal').addEventListener('click', closeEdit);
  document.getElementById('btn-cancel').addEventListener('click', closeEdit);
  document.getElementById('btn-save').addEventListener('click', saveEdit);
  document.getElementById('btn-delete').addEventListener('click', deleteEdit);
  document.getElementById('btn-pick').addEventListener('click', () => {
    enterPickingMode((lat, lng) => {
      document.getElementById('f-lat').value = lat.toFixed(6);
      document.getElementById('f-lng').value = lng.toFixed(6);
      toast('已選座標');
    });
  });

  // Tap outside modal to close
  document.getElementById('modal').addEventListener('click', e => {
    if (e.target.id === 'modal') closeEdit();
  });

  // Layer toggle
  document.querySelectorAll('#layer-toggle button').forEach(b => {
    b.addEventListener('click', () => setBaseLayer(b.dataset.layer));
  });

  // Search input (debounced)
  const searchInput = document.getElementById('f-search');
  searchInput.addEventListener('input', e => {
    clearTimeout(searchDebounce);
    const q = e.target.value.trim();
    if (!q) { document.getElementById('f-search-results').hidden = true; return; }
    document.getElementById('f-search-results').hidden = false;
    document.getElementById('f-search-results').innerHTML = '<div class="search-loading">搜尋中…</div>';
    searchDebounce = setTimeout(async () => {
      const items = await searchPlaces(q);
      renderSearchResults(items);
    }, 350);
  });
  // hide search results when clicking elsewhere
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-box')) {
      document.getElementById('f-search-results').hidden = true;
    }
  });

  // Global search wire-up
  wireGlobalSearch();

  // Fetch description in modal
  document.getElementById('btn-fetch-desc').addEventListener('click', async () => {
    const name = document.getElementById('f-name').value.trim();
    if (!name) return toast('請先輸入名稱');
    const target = document.getElementById('f-desc');
    target.value = '載入中…';
    const desc = await fetchWikipediaSummary(name);
    target.value = desc || '找不到相關說明。可手動輸入。';
  });

  // No service worker on this domain path — always fetch fresh.
});

/* =========================================================
   Budget Tracker
   ========================================================= */

const BUDGET_KEY = 'yunnan-budget-v1';
const SETTINGS_KEY = 'yunnan-budget-settings-v1';

const CATEGORIES = {
  hotel:     { label: '住宿',  color: '#1d3557', icon: '🏨' },
  flight:    { label: '機票',  color: '#c1432e', icon: '✈️' },
  transport: { label: '交通',  color: '#e8a444', icon: '🚐' },
  food:      { label: '餐飲',  color: '#2a9d8f', icon: '🍜' },
  activity:  { label: '活動',  color: '#8d5524', icon: '🎟️' },
  shopping:  { label: '購物',  color: '#a37cb1', icon: '🛍️' },
  other:     { label: '其他',  color: '#6c757d', icon: '📦' }
};

let expenses = [];
let settings = { fxRate: 1.10, travelers: 1 };
let activeCategory = 'all';
let editingExpenseId = null;

function loadBudget() {
  try {
    const e = safeStorage.getItem(BUDGET_KEY);
    expenses = e ? JSON.parse(e) : [];
  } catch (_) { expenses = []; }
  try {
    const s = safeStorage.getItem(SETTINGS_KEY);
    if (s) settings = { ...settings, ...JSON.parse(s) };
  } catch (_) {}
}
function saveBudget() {
  scheduleCloudSync();
  try { safeStorage.setItem(BUDGET_KEY, JSON.stringify(expenses)); } catch (_) {}
}
function saveSettings() {
  scheduleCloudSync();
  try { safeStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
}

// --- Cloud sync hook (only fires if sync.js is configured) ---
function scheduleCloudSync() {
  try { window.cloudSync && window.cloudSync.scheduleSync(); } catch (_) {}
}

function toCNY(amount, currency) {
  const a = parseFloat(amount) || 0;
  if (currency === 'CNY') return a;
  if (currency === 'HKD') return a / settings.fxRate;          // HKD -> CNY
  if (currency === 'USD') return a * 7.0 / settings.fxRate;    // USD -> HKD -> CNY (approx)
  return a;
}
function toHKD(amount, currency) {
  return toCNY(amount, currency) * settings.fxRate;
}
function fmt(n, suffix = '') {
  return new Intl.NumberFormat('zh-HK', { maximumFractionDigits: 0 }).format(Math.round(n)) + suffix;
}

/* ---- View switching ---- */
function setView(v) {
  document.body.classList.toggle('view-budget', v === 'budget');
  document.getElementById('budget-view').hidden = (v !== 'budget');
  document.querySelectorAll('.view-tab').forEach(b => {
    const on = b.dataset.view === v;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  if (v === 'budget') renderBudget();
  else if (map) setTimeout(() => map.invalidateSize(), 50);
}

/* ---- Render budget ---- */
function renderBudget() {
  // populate day select in expense modal
  const daySel = document.getElementById('e-day');
  daySel.innerHTML = '<option value="">—</option>' +
    state.days.map(d => `<option value="${d.day}">Day ${d.day} · ${d.date} · ${d.city}</option>`).join('');

  // settings inputs
  document.getElementById('fx-rate').value = settings.fxRate;
  document.getElementById('travelers').value = settings.travelers;

  // totals (in CNY base)
  const totalCNY  = expenses.reduce((s, x) => s + toCNY(x.amount, x.currency), 0);
  const paidCNY   = expenses.filter(x => x.status === 'paid').reduce((s, x) => s + toCNY(x.amount, x.currency), 0);
  const unpaidCNY = expenses.filter(x => x.status !== 'paid').reduce((s, x) => s + toCNY(x.amount, x.currency), 0);
  const days = state.days.length;
  const avg = days > 0 && settings.travelers > 0 ? totalCNY / days / settings.travelers : 0;

  document.getElementById('sum-total').textContent      = '¥' + fmt(totalCNY);
  document.getElementById('sum-total-hkd').textContent  = '≈ HK$' + fmt(totalCNY * settings.fxRate);
  document.getElementById('sum-paid').textContent       = '¥' + fmt(paidCNY);
  document.getElementById('sum-unpaid').textContent     = '¥' + fmt(unpaidCNY);
  document.getElementById('sum-avg').textContent        = '¥' + fmt(avg);

  // category breakdown
  const byCat = {};
  Object.keys(CATEGORIES).forEach(k => byCat[k] = 0);
  expenses.forEach(x => { byCat[x.category] = (byCat[x.category] || 0) + toCNY(x.amount, x.currency); });

  const bar = document.getElementById('breakdown-bar');
  const legend = document.getElementById('breakdown-legend');
  if (totalCNY > 0) {
    const segs = Object.entries(byCat)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    bar.innerHTML = segs.map(([k, v]) =>
      `<div style="background:${CATEGORIES[k].color};width:${(v / totalCNY * 100).toFixed(2)}%"
            title="${CATEGORIES[k].label} ¥${fmt(v)}"></div>`
    ).join('');
    legend.innerHTML = segs.map(([k, v]) =>
      `<span class="legend-item">
         <span class="legend-swatch" style="background:${CATEGORIES[k].color}"></span>
         ${CATEGORIES[k].label}
         <span class="legend-amt">¥${fmt(v)}</span>
         <span style="color:var(--ink-3);font-size:11px;">${(v / totalCNY * 100).toFixed(0)}%</span>
       </span>`
    ).join('');
  } else {
    bar.innerHTML = '<div style="background:var(--border);width:100%"></div>';
    legend.innerHTML = '<span class="legend-item" style="color:var(--ink-3)">尚無資料</span>';
  }

  // category filter buttons
  document.querySelectorAll('.cat-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === activeCategory);
  });

  // expense list
  const list = document.getElementById('expense-list');
  const filtered = expenses
    .filter(x => activeCategory === 'all' || x.category === activeCategory)
    .sort((a, b) => (a.day || 99) - (b.day || 99));

  if (filtered.length === 0) {
    list.innerHTML = `<div class="expense-empty">
      ${activeCategory === 'all' ? '尚未新增任何開支。點「新增項目」或「由行程帶入酒店」開始。' : '此分類暫無項目。'}
    </div>`;
    return;
  }

  list.innerHTML = filtered.map(x => {
    const cat = CATEGORIES[x.category] || CATEGORIES.other;
    const dayInfo = x.day ? `<span class="day-tag">Day ${x.day}</span>` : '';
    const statusLabel = { paid: '已付', unpaid: '未付', pending: '待確認' }[x.status] || '';
    const cny = toCNY(x.amount, x.currency);
    const hkd = cny * settings.fxRate;
    const showDual = x.currency !== 'CNY';
    return `<div class="expense-row" data-id="${x.id}">
      <div class="expense-icon" style="background:${cat.color}22;color:${cat.color}">${cat.icon}</div>
      <div class="expense-main">
        <div class="expense-name">${escapeHTML(x.name)}</div>
        <div class="expense-meta">
          ${dayInfo}
          <span>${cat.label}</span>
          ${statusLabel ? `<span class="status-pill ${x.status}">${statusLabel}</span>` : ''}
          ${x.method ? `<span>· ${escapeHTML(x.method)}</span>` : ''}
        </div>
      </div>
      <div>
        <div class="expense-amt">${x.currency === 'CNY' ? '¥' : x.currency === 'HKD' ? 'HK$' : 'US$'}${fmt(x.amount)}</div>
        <div class="expense-amt-sub">${showDual ? '≈ ¥' + fmt(cny) + ' / HK$' + fmt(hkd) : '≈ HK$' + fmt(hkd)}</div>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.expense-row').forEach(row => {
    row.addEventListener('click', () => openExpenseModal(row.dataset.id));
  });
}

/* ---- Expense modal ---- */
function openExpenseModal(id = null) {
  editingExpenseId = id;
  const modal = document.getElementById('expense-modal');
  const title = document.getElementById('expense-modal-title');
  const delBtn = document.getElementById('btn-delete-expense');

  // populate day options
  const daySel = document.getElementById('e-day');
  daySel.innerHTML = '<option value="">—</option>' +
    state.days.map(d => `<option value="${d.day}">Day ${d.day} · ${d.date} · ${d.city}</option>`).join('');

  if (id) {
    const x = expenses.find(e => e.id === id);
    if (!x) return;
    title.textContent = '編輯開支';
    document.getElementById('e-name').value = x.name || '';
    document.getElementById('e-cat').value = x.category;
    document.getElementById('e-day').value = x.day || '';
    document.getElementById('e-amount').value = x.amount;
    document.getElementById('e-currency').value = x.currency;
    document.getElementById('e-status').value = x.status;
    document.getElementById('e-method').value = x.method || '';
    document.getElementById('e-note').value = x.note || '';
    delBtn.style.display = '';
  } else {
    title.textContent = '新增開支';
    document.getElementById('e-name').value = '';
    document.getElementById('e-cat').value = 'hotel';
    document.getElementById('e-day').value = '';
    document.getElementById('e-amount').value = '';
    document.getElementById('e-currency').value = 'CNY';
    document.getElementById('e-status').value = 'unpaid';
    document.getElementById('e-method').value = '';
    document.getElementById('e-note').value = '';
    delBtn.style.display = 'none';
  }
  modal.hidden = false;
}
function closeExpenseModal() {
  document.getElementById('expense-modal').hidden = true;
  editingExpenseId = null;
}
function saveExpense() {
  const name = document.getElementById('e-name').value.trim();
  const amount = parseFloat(document.getElementById('e-amount').value);
  if (!name) return toast('請輸入名稱');
  if (isNaN(amount) || amount < 0) return toast('請輸入有效金額');

  const data = {
    name,
    category: document.getElementById('e-cat').value,
    day: parseInt(document.getElementById('e-day').value, 10) || null,
    amount,
    currency: document.getElementById('e-currency').value,
    status: document.getElementById('e-status').value,
    method: document.getElementById('e-method').value.trim(),
    note: document.getElementById('e-note').value.trim()
  };

  if (editingExpenseId) {
    const idx = expenses.findIndex(e => e.id === editingExpenseId);
    if (idx >= 0) expenses[idx] = { ...expenses[idx], ...data };
  } else {
    data.id = 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    expenses.push(data);
  }
  saveBudget();
  closeExpenseModal();
  renderBudget();
  toast('已儲存');
}
function deleteExpense() {
  if (!editingExpenseId) return;
  if (!confirm('確定刪除此項目？')) return;
  expenses = expenses.filter(e => e.id !== editingExpenseId);
  saveBudget();
  closeExpenseModal();
  renderBudget();
  toast('已刪除');
}

/* ---- Seed hotels from itinerary ---- */
function seedHotels() {
  // Add unique hotels (one per consecutive stay block)
  const seen = new Set();
  let added = 0;
  state.days.forEach(d => {
    const key = d.hotel.name;
    if (key && !seen.has(key)) {
      seen.add(key);
      // skip airport "hotel" entries
      if (/機場/.test(key)) return;
      // check if already exists
      const exists = expenses.some(e => e.category === 'hotel' && e.name === key);
      if (!exists) {
        expenses.push({
          id: 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          name: key,
          category: 'hotel',
          day: d.day,
          amount: 0,
          currency: 'CNY',
          status: 'unpaid',
          method: '',
          note: `Day ${d.day} 入住`
        });
        added++;
      }
    }
  });
  saveBudget();
  renderBudget();
  toast(added > 0 ? `已帶入 ${added} 間酒店，請填入金額` : '酒店已全部帶入');
}

function clearAllExpenses() {
  if (expenses.length === 0) return toast('沒有項目可清空');
  if (!confirm(`確定刪除全部 ${expenses.length} 個項目？`)) return;
  expenses = [];
  saveBudget();
  renderBudget();
  toast('已清空');
}

/* ---- Wire up budget UI (called after DOMContentLoaded) ---- */
function wireBudget() {
  loadBudget();

  document.querySelectorAll('.view-tab').forEach(b => {
    b.addEventListener('click', () => setView(b.dataset.view));
  });

  document.querySelectorAll('.cat-btn').forEach(b => {
    b.addEventListener('click', () => {
      activeCategory = b.dataset.cat;
      renderBudget();
    });
  });

  document.getElementById('fx-rate').addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    if (v > 0) { settings.fxRate = v; saveSettings(); renderBudget(); }
  });
  document.getElementById('travelers').addEventListener('change', e => {
    const v = parseInt(e.target.value, 10);
    if (v > 0) { settings.travelers = v; saveSettings(); renderBudget(); }
  });

  document.getElementById('btn-add-expense').addEventListener('click', () => openExpenseModal(null));
  document.getElementById('btn-close-expense').addEventListener('click', closeExpenseModal);
  document.getElementById('btn-cancel-expense').addEventListener('click', closeExpenseModal);
  document.getElementById('btn-save-expense').addEventListener('click', saveExpense);
  document.getElementById('btn-delete-expense').addEventListener('click', deleteExpense);
  document.getElementById('btn-seed-hotels').addEventListener('click', seedHotels);
  document.getElementById('btn-clear-expenses').addEventListener('click', clearAllExpenses);

  document.getElementById('expense-modal').addEventListener('click', e => {
    if (e.target.id === 'expense-modal') closeExpenseModal();
  });
}

// --- Global Search ---
let globalSearchDebounce;

function openGlobalSearch() {
  const overlay = document.getElementById('global-search-overlay');
  overlay.hidden = false;
  setTimeout(() => document.getElementById('global-search-input').focus(), 50);
}
function closeGlobalSearch() {
  document.getElementById('global-search-overlay').hidden = true;
  document.getElementById('global-search-input').value = '';
  document.getElementById('global-search-results').innerHTML =
    '<div class="global-search-empty">輸入關鍵字開始搜尋</div>';
  document.getElementById('global-search-badge').hidden = true;
}

function wireGlobalSearch() {
  document.getElementById('btn-global-search').addEventListener('click', openGlobalSearch);
  document.getElementById('btn-close-global-search').addEventListener('click', closeGlobalSearch);
  document.getElementById('global-search-overlay').addEventListener('click', e => {
    if (e.target.id === 'global-search-overlay') closeGlobalSearch();
  });
  // ESC to close
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('global-search-overlay').hidden) {
      closeGlobalSearch();
    }
  });

  const input = document.getElementById('global-search-input');
  const resultsBox = document.getElementById('global-search-results');
  input.addEventListener('input', e => {
    clearTimeout(globalSearchDebounce);
    const q = e.target.value.trim();
    if (!q) {
      resultsBox.innerHTML = '<div class="global-search-empty">輸入關鍵字開始搜尋</div>';
      document.getElementById('global-search-badge').hidden = true;
      return;
    }
    resultsBox.innerHTML = '<div class="global-search-empty">搜尋中…</div>';
    globalSearchDebounce = setTimeout(async () => {
      const items = await searchPlacesGlobal(q);
      renderGlobalSearchResults(items);
    }, 350);
  });
}

async function searchPlacesGlobal(q) {
  // Reuse existing searchPlaces but redirect badge target
  const g = await searchPlacesGoogle(q);
  if (g && g.length > 0) {
    setGlobalBadge('google');
    return g;
  }
  setGlobalBadge('osm');
  return await searchPlacesOSM(q);
}

function setGlobalBadge(source) {
  const el = document.getElementById('global-search-badge');
  if (!el) return;
  if (source === 'google') {
    el.textContent = 'Google Places';
    el.className = 'search-source-badge active-google';
  } else {
    el.textContent = 'OpenStreetMap';
    el.className = 'search-source-badge active-osm';
  }
  el.hidden = false;
}

function renderGlobalSearchResults(items) {
  const box = document.getElementById('global-search-results');
  if (!items || items.length === 0) {
    box.innerHTML = '<div class="global-search-empty">找不到相關地點</div>';
    return;
  }
  const dayOptions = state.days.map((d, i) => `<option value="${i}">Day ${d.day} · ${d.city}</option>`).join('');
  box.innerHTML = items.map((it, i) => {
    const badge = it.source === 'google'
      ? '<span class="search-source g">G</span>'
      : '<span class="search-source o">OSM</span>';
    return `<div class="global-search-item" data-idx="${i}">
      <div class="global-search-item-main">
        ${badge}
        <div class="global-search-item-text">
          <div class="global-search-item-name">${escapeHTML(it.name || '')}</div>
          <div class="global-search-item-addr">${escapeHTML(it.address || '')}</div>
        </div>
      </div>
      <div class="global-search-item-actions">
        <select class="global-search-day" data-role="day">${dayOptions}</select>
        <button class="btn-primary btn-sm" data-role="add">加入</button>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('.global-search-item').forEach(el => {
    const idx = parseInt(el.dataset.idx, 10);
    const it = items[idx];
    const daySel = el.querySelector('[data-role="day"]');
    daySel.value = String(Math.max(0, activeDayIdx));

    // Click on row (not on actions) -> zoom to location and prefill modal
    el.querySelector('.global-search-item-main').addEventListener('click', async () => {
      let lat = it.lat, lng = it.lng, name = it.name;
      if (it.source === 'google' && it.place_id) {
        const detail = await getGooglePlaceCoords(it.place_id);
        if (detail) { lat = detail.lat; lng = detail.lng; name = detail.name || name; }
      }
      if (lat == null || lng == null) { toast('取得坐標失敗'); return; }
      closeGlobalSearch();
      map.setView([lat, lng], 15);
      showAddHerePopup(L.latLng(lat, lng));
    });

    el.querySelector('[data-role="add"]').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      let lat = it.lat, lng = it.lng, name = it.name;
      if (it.source === 'google' && it.place_id) {
        const detail = await getGooglePlaceCoords(it.place_id);
        if (detail) { lat = detail.lat; lng = detail.lng; name = detail.name || name; }
      }
      if (lat == null || lng == null) { toast('取得坐標失敗'); return; }
      const dayIdx = parseInt(daySel.value, 10);
      state.days[dayIdx].spots.push({
        name: name || '新地點',
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        note: it.address || ''
      });
      saveState();
      activeDayIdx = dayIdx;
      closeGlobalSearch();
      renderAll();
      map.setView([lat, lng], 14);
      toast(`已加入 Day ${state.days[dayIdx].day}：${name}`);
    });
  });
}

// auto-init when DOM ready (works alongside the main DOMContentLoaded handler above)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireBudget);
  document.addEventListener('DOMContentLoaded', wireCloudSyncUI);
} else {
  wireBudget();
  wireCloudSyncUI();
}

/* ---- Cloud sync UI (sync badge in topbar + expense modal hint) ---- */
function wireCloudSyncUI() {
  if (!window.cloudSync) return;
  const wrap   = document.getElementById('sync-wrap');
  const badge  = document.getElementById('sync-badge');
  const label  = document.getElementById('sync-label');
  const menu   = document.getElementById('sync-menu');
  const status = document.getElementById('sync-menu-status');
  const devLbl = document.getElementById('sync-device-label');
  const hint   = document.getElementById('expense-save-hint');

  const configured = window.cloudSync.isConfigured();
  if (!wrap) return;
  wrap.hidden = false; // always show, but tone changes when not configured
  if (hint) hint.hidden = !configured;

  // Reflect current device name in the menu item
  const refreshDeviceLabel = () => {
    if (devLbl) devLbl.textContent = '裝置：' + window.cloudSync.getDeviceName();
  };
  refreshDeviceLabel();

  // Hook status indicator
  window.cloudSync.onStatus((s) => {
    badge.classList.remove('is-syncing', 'is-synced', 'is-error', 'is-conflict', 'is-pending');
    let text = '同步';
    let title = '';
    if (!configured) { text = '未啟用'; title = '雲端同步未設定 — 請編輯 config.js'; }
    else if (s.state === 'syncing') { badge.classList.add('is-syncing'); text = '同步中'; }
    else if (s.state === 'pending') { badge.classList.add('is-pending'); text = '待上傳'; }
    else if (s.state === 'synced')  { badge.classList.add('is-synced');  text = '已同步'; }
    else if (s.state === 'conflict'){ badge.classList.add('is-conflict');text = '衝突'; }
    else if (s.state === 'error')   { badge.classList.add('is-error');   text = '錯誤'; }
    if (label) label.textContent = text;
    if (s.message) title = s.message;
    badge.title = title || text;
    if (status) status.textContent = s.message || (configured ? '空閒' : '未設定 JSONBin 憑證');
  });

  // Toggle menu
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) menu.hidden = true;
  });

  // Menu actions
  menu.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    menu.hidden = true;
    if (!configured) {
      alert('雲端同步未設定。請打開 config.js，填入 JSONBIN_BIN_ID 同 JSONBIN_ACCESS_KEY，重新部署。');
      return;
    }
    if (act === 'pull') {
      try { await window.cloudSync.pullCloud({ force: true }); }
      catch (_) {}
    } else if (act === 'push') {
      try { await window.cloudSync.pushCloud({ force: true }); }
      catch (_) {}
    } else if (act === 'rename') {
      const cur = window.cloudSync.getDeviceName();
      const next = prompt('裝置名稱（用來識別係邊部機嘅改動）：', cur);
      if (next && next.trim()) {
        window.cloudSync.setDeviceName(next.trim().slice(0, 20));
        refreshDeviceLabel();
      }
    }
  });

  // Auto pull on startup if configured
  if (configured) {
    setTimeout(() => {
      window.cloudSync.pullCloud().catch(() => {});
    }, 600);
  }
}
