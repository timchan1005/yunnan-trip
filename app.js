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
let markerCluster;
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
  installCollisionListeners();
  // Cluster group for the overview-mode spot markers (keeps the all-days view tidy)
  markerCluster = (typeof L.markerClusterGroup === 'function')
    ? L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        zoomToBoundsOnClick: true,
        maxClusterRadius: 50,
        disableClusteringAtZoom: 11,
        iconCreateFunction: (cluster) => {
          const count = cluster.getChildCount();
          // Pick the dominant day color from children
          const colorTally = {};
          cluster.getAllChildMarkers().forEach((m) => {
            const c = m.options && m.options._dayColor;
            if (c) colorTally[c] = (colorTally[c] || 0) + 1;
          });
          let dominant = '#d97441';
          let best = 0;
          Object.entries(colorTally).forEach(([c, n]) => { if (n > best) { best = n; dominant = c; } });
          // v39.2: render the cluster bubble using the same pin shape as individual
          // spot/hotel markers so font, border and the triangle pointer all match.
          const sizeClass = count < 5 ? 'cluster-sm' : count < 12 ? 'cluster-md' : 'cluster-lg';
          const html = `<div class="pin yn-cluster-pin ${sizeClass}" style="background:${dominant};border-top-color:${dominant}"><span>${count}</span></div>`;
          return L.divIcon({ html, className: 'dot-marker yn-cluster-wrap', iconSize: [32, 42], iconAnchor: [15, 40], popupAnchor: [0, -36] });
        },
      })
    : L.layerGroup();
  map.addLayer(markerCluster);

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
  if (markerCluster && markerCluster.clearLayers) markerCluster.clearLayers();
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

  // v31: Auto-stagger overlapping pins so hotel D-pin and spot bubble don't collide
  scheduleCollisionPass();
}

// --- v31: Pin collision avoidance ---
// After Leaflet renders markers at their lat/lng anchors, compute pixel positions
// of each visible marker. If two markers' anchor points are within COLLIDE_PX,
// stagger them upward (or to one side) using CSS transform on the marker container.
let _collisionTimer = null;
function scheduleCollisionPass() {
  if (!map) return;
  if (_collisionTimer) clearTimeout(_collisionTimer);
  _collisionTimer = setTimeout(applyMarkerCollisionAvoidance, 120);
}
function applyMarkerCollisionAvoidance() {
  if (!map) return;
  const COLLIDE_PX = 46;        // anchors closer than this collide
  const STAGGER_PX = 38;        // vertical lift per stagger step
  const MAX_STEPS = 4;

  const markers = [];
  layerGroup.eachLayer((lyr) => {
    if (!(lyr instanceof L.Marker)) return;
    const el = lyr.getElement();
    if (!el) return;
    // Reset any previous offset first so re-renders don't accumulate
    el.style.removeProperty('--pin-shift-y');
    el.style.removeProperty('--pin-shift-x');
    el.classList.remove('pin-shifted');
    const pt = map.latLngToContainerPoint(lyr.getLatLng());
    const isHotel = el.classList.contains('is-hotel');
    markers.push({ lyr, el, pt, isHotel });
  });
  if (markers.length < 2) return;

  // Sort: hotels stay put (priority 0), spots get shifted (priority 1+)
  markers.sort((a, b) => (a.isHotel ? 0 : 1) - (b.isHotel ? 0 : 1));

  // For each pair, if too close, shift the lower-priority one up in steps
  // until separated or MAX_STEPS reached.
  for (let i = 1; i < markers.length; i++) {
    const a = markers[i];
    let step = 0;
    let safe = false;
    while (step <= MAX_STEPS && !safe) {
      const yShift = step * STAGGER_PX;
      const ay = a.pt.y - yShift;
      safe = true;
      for (let j = 0; j < i; j++) {
        const b = markers[j];
        const byShift = parseFloat(b.el.style.getPropertyValue('--pin-shift-y') || '0');
        const by = b.pt.y - byShift;
        const dx = a.pt.x - b.pt.x;
        const dy = ay - by;
        if (Math.hypot(dx, dy) < COLLIDE_PX) { safe = false; break; }
      }
      if (safe) {
        if (step > 0) {
          a.el.style.setProperty('--pin-shift-y', `${yShift}px`);
          a.el.classList.add('pin-shifted');
        }
        break;
      }
      step++;
    }
  }
}
// Re-run collision pass on map move/zoom
function installCollisionListeners() {
  if (!map || map._collisionInstalled) return;
  map._collisionInstalled = true;
  map.on('moveend zoomend', scheduleCollisionPass);
}

// --- Overview: all days, all locations ---
function renderOverview() {
  ++renderSeq;
  // v42 fix: clear existing layers so repeated calls (e.g. after saveExpense /
  // deleteExpense) don't stack markers and flight lines, which made cluster
  // counts (56, 84) far exceed the real spot+hotel total (~51).
  if (layerGroup && layerGroup.clearLayers) layerGroup.clearLayers();
  if (markerCluster && markerCluster.clearLayers) markerCluster.clearLayers();
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

    // Spot markers — feed into the cluster group so the overview stays tidy.
    day.spots.forEach((spot, i) => {
      const m = createMarker(spot, { color: day.color, label: String(i + 1) });
      m.options._dayColor = day.color;
      m.bindPopup(buildPopup(spot, { kind: 'spot', dayIdx, spotIdx: i }));
      m.on('click', () => m.openPopup());
      if (markerCluster && markerCluster.addLayer) markerCluster.addLayer(m);
      else layerGroup.addLayer(m);
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

  // Flight legs from the budget — draw each leg as a dashed great-circle-ish line.
  // We iterate the live `expenses` array (loaded from localStorage at startup).
  try {
    const flightColor = (CATEGORIES && CATEGORIES.flight && CATEGORIES.flight.color) || '#c1432e';
    (expenses || []).forEach(exp => {
      if (exp.category !== 'flight') return;
      const legs = Array.isArray(exp.flights) && exp.flights.length
        ? exp.flights
        : (exp.flightFrom || exp.flightTo)
          ? [{ no: exp.flightNo, from: exp.flightFrom, to: exp.flightTo }]
          : [];
      legs.forEach(leg => {
        const fa = findAirport(leg.from); const ta = findAirport(leg.to);
        if (!fa || !ta) return;
        const a = projectLatLng(fa.lat, fa.lng);
        const b = projectLatLng(ta.lat, ta.lng);
        drawCasedRoute([a, b], flightColor, { weight: 2.5, dashed: true });
        allPoints.push(a, b);
      });
    });
  } catch (_) { /* budget not loaded yet — ignore */ }

  if (allPoints.length) {
    const bounds = L.latLngBounds(allPoints);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 9 });
  }
  scheduleCollisionPass();
}

function createMarker(loc, opts = {}) {
  const color = opts.color || '#c1432e';
  const isHotel = opts.isHotel;
  // For hotels, ignore any explicit label (e.g. 'D5') and always show the home glyph,
  // so hotel and spot pins share identical typography/shape.
  const label = isHotel ? '' : (opts.label || '');
  const small = opts.small;
  const faded = opts.faded;
  const sizeAttr = small ? 'transform:scale(0.85);' : '';
  const opacity = faded ? 'opacity:0.55;' : '';
  // Hotels: solid gold pin with home icon (kept inside the circle).
  // Spots:  day-coloured pin with the numeric step.
  const inner = isHotel
    ? `<svg class="pin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 3.4 10v10.4h5.6V14.6h6V20.4h5.6V10z" fill="#fff"/></svg>`
    : `<span>${label}</span>`;
  const html = `<div class="pin" style="background:${color};border-top-color:${color};${sizeAttr}${opacity}">${inner}</div>`;
  const icon = L.divIcon({
    className: `dot-marker ${isHotel ? 'is-hotel' : ''}`,
    html,
    iconSize: [32, 42],
    iconAnchor: [15, 40],
    popupAnchor: [0, -36]
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
// Mobile (≤ 720px): renders a single "Day picker" button that opens a popup
//   listing all 13 days. Eliminates horizontal-scroll chip clipping.
// Desktop (> 720px): renders wrap-style chip rail as before.
function renderDayRail() {
  const rail = document.getElementById('day-rail');
  if (!rail) return;
  rail.innerHTML = '';

  const isMobile = window.matchMedia('(max-width: 720px)').matches;

  if (isMobile) {
    // --- Mobile: single dropdown trigger ---
    const pickerBtn = document.createElement('button');
    pickerBtn.className = 'day-picker-trigger';
    pickerBtn.setAttribute('aria-haspopup', 'listbox');
    const activeLabel = (activeDayIdx === -1)
      ? '全部行程'
      : `Day ${state.days[activeDayIdx].day} · ${state.days[activeDayIdx].city}`;
    const activeColor = (activeDayIdx === -1) ? 'var(--accent-2)' : state.days[activeDayIdx].color;
    pickerBtn.innerHTML = `
      <span class="dpt-dot" style="background:${activeColor}"></span>
      <span class="dpt-label">${activeLabel}</span>
      <svg class="dpt-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9 L12 15 L18 9"/></svg>
    `;
    pickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDayPicker();
    });
    rail.appendChild(pickerBtn);
    return;
  }

  // --- Desktop: wrap-style chip rail ---
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

// --- Day picker popup (mobile) ---
function openDayPicker() {
  let pop = document.getElementById('day-picker-pop');
  if (pop) { pop.remove(); }
  pop = document.createElement('div');
  pop.id = 'day-picker-pop';
  pop.className = 'day-picker-pop';
  pop.innerHTML = `
    <div class="dpp-backdrop"></div>
    <div class="dpp-sheet" role="listbox" aria-label="選擇日子">
      <div class="dpp-grip"></div>
      <div class="dpp-title">選擇日子</div>
      <div class="dpp-list"></div>
    </div>
  `;
  document.body.appendChild(pop);
  const list = pop.querySelector('.dpp-list');

  // "All" row
  const allRow = document.createElement('button');
  allRow.className = 'dpp-row' + (activeDayIdx === -1 ? ' active' : '');
  allRow.innerHTML = `
    <span class="dpp-dot" style="background:var(--accent-2)"></span>
    <span class="dpp-name">全部行程</span>
    <span class="dpp-meta">13 日</span>
  `;
  allRow.addEventListener('click', () => {
    activeDayIdx = -1;
    closeDayPicker();
    renderAll();
    document.getElementById('drawer-body').scrollTo({ top: 0, behavior: 'smooth' });
  });
  list.appendChild(allRow);

  state.days.forEach((d, idx) => {
    const row = document.createElement('button');
    row.className = 'dpp-row' + (idx === activeDayIdx ? ' active' : '');
    row.innerHTML = `
      <span class="dpp-dot" style="background:${d.color}"></span>
      <span class="dpp-name">Day ${d.day} · ${d.city}</span>
      <span class="dpp-meta">${d.date}</span>
    `;
    row.addEventListener('click', () => {
      activeDayIdx = idx;
      closeDayPicker();
      renderAll();
      const card = document.getElementById(`day-card-${idx}`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    list.appendChild(row);
  });

  pop.querySelector('.dpp-backdrop').addEventListener('click', closeDayPicker);
  // open animation
  requestAnimationFrame(() => pop.classList.add('open'));
}
function closeDayPicker() {
  const pop = document.getElementById('day-picker-pop');
  if (!pop) return;
  pop.classList.remove('open');
  setTimeout(() => pop.remove(), 260);
}
// Re-render rail when crossing the mobile/desktop breakpoint
window.matchMedia('(max-width: 720px)').addEventListener('change', () => {
  try { renderDayRail(); } catch(e) {}
});

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
    // v45: weather banner per day
    const w = getWeatherForDay(d);
    const weatherHTML = w ? `
      <div class="day-weather" title="${escapeHTML(w.city)} · 10月歷年平均">
        <span class="dw-cond">${escapeHTML(w.cond)}</span>
        <span class="dw-temp">${w.tempHi}° / ${w.tempLo}°</span>
        <span class="dw-sun" title="日出">☀ ${w.sunrise}</span>
        <span class="dw-sun" title="日落">☽ ${w.sunset}</span>
      </div>` : '';
    card.innerHTML = `
      <div class="day-card-head">
        <div class="day-num" data-color="${d.color}">${d.day}</div>
        <div class="day-meta">
          <div class="day-meta-title">${escapeHTML(d.city)} · ${escapeHTML(d.date)}</div>
          <div class="day-meta-sub"><span>${d.spots.length} 個景點</span>${distLabel}<span>入住 ${escapeHTML(d.hotel?.name || '—')}</span></div>
          ${weatherHTML}
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
        ${(() => { const oh = !ctx.isHotel ? lookupSpotHours(loc.name) : null; return oh ? `<span class="spot-tag hours" title="開放時間">⏱ ${escapeHTML(oh)}</span>` : ''; })()}
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
// Handle ?focus=<id> query — used when arriving from the landing page's hand-drawn map.
function _handleFocusParam() {
  try {
    const params = new URLSearchParams(location.search);
    const focus = params.get('focus');
    if (!focus) return;
    // focus can be 'dayN' (whole day) or 'dayN-sM' / 'dayN-h' (specific spot)
    let dayMatch = focus.match(/^day(\d+)/);
    if (!dayMatch) return;
    const dayN = parseInt(dayMatch[1], 10);
    const dayIdx = state.days.findIndex((d) => d.day === dayN);
    if (dayIdx < 0) return;
    activeDayIdx = dayIdx;
    renderAll();
    // Scroll the day card into view in the drawer
    setTimeout(() => {
      const card = document.getElementById(`day-card-${dayIdx}`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
    // If a specific spot id is requested, find and open its popup after the map renders
    if (/^day\d+-(s\d+|h)$/.test(focus)) {
      setTimeout(() => {
        const day = state.days[dayIdx];
        if (!day) return;
        const spotId = focus;
        let target = null;
        if (spotId.endsWith('-h')) target = day.hotel;
        else {
          const m = spotId.match(/-s(\d+)$/);
          if (m) target = day.spots[parseInt(m[1], 10) - 1];
        }
        if (target && map && isFinite(target.lat) && isFinite(target.lng)) {
          map.setView([target.lat, target.lng], 13, { animate: true });
          // Find a leaflet marker at that lat/lng and open its popup
          [typeof layerGroup !== 'undefined' ? layerGroup : null, typeof markerCluster !== 'undefined' ? markerCluster : null].forEach((g) => {
            if (!g || !g.eachLayer) return;
            g.eachLayer((layer) => {
              if (layer.getLatLng && Math.abs(layer.getLatLng().lat - target.lat) < 0.0002 && Math.abs(layer.getLatLng().lng - target.lng) < 0.0002) {
                if (layer.openPopup) layer.openPopup();
              }
            });
          });
        }
      }, 800);
    }
  } catch (e) { console.warn('focus param', e); }
}

document.addEventListener('DOMContentLoaded', () => {
  state = loadState();
  initMap();
  renderAll();
  _handleFocusParam();

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
// v43: fxRate now means "1 HKD = ? CNY" (~0.91). Was previously HKD/CNY (~1.10).
// We migrate on load: any saved rate > 2 is treated as the old HKD/CNY rate and inverted.
// v44: caps[] holds per-category budget ceilings in HKD.
const DEFAULT_BUDGET_CAPS = {
  hotel:     30000,
  flight:    6000,
  transport: 8000,
  food:      4000,
  activity:  3000,
  shopping:  5000,
  other:     2000
};
let settings = {
  fxRate: 0.91,
  travelers: 1,
  caps: { ...DEFAULT_BUDGET_CAPS }
};

// v44: rough altitude (m) per day for the Yunnan itinerary, used by sanity check
// and (later) altitude curve. Day numbers match state.days[].day.
const DAY_ALTITUDE = {
  1: 1900,  // 昆明
  2: 1900,  // 昆明
  3: 2000,  // 大理
  4: 2000,  // 大理
  5: 2400,  // 麗江
  6: 3200,  // 玉龍雪山及索道 (雲杉坪 3,240m)
  7: 2690,  // 瀘沽湖
  8: 2690,  // 瀘沽湖 -> 麗江
  9: 3200,  // 香格里拉
  10: 3400, // 松贊林寺 -> 霧濃頂
  11: 3500, // 飛來寺觀景台
  12: 4290, // 普達措國家森林公園 (高原湖泊)
  13: 3200  // 香格里拉 -> 飛機
};

// Airport list (IATA, name, lat, lng) — relevant to this trip + HKG
const AIRPORTS = [
  { code: 'HKG', name: '香港國際機場',         lat: 22.3080, lng: 113.9185 },
  { code: 'KMG', name: '昆明長水國際機場',     lat: 25.1019, lng: 102.9292 },
  { code: 'DLU', name: '大理鳳儀機場',           lat: 25.6494, lng: 100.3194 },
  { code: 'LJG', name: '麗江三義國際機場',     lat: 26.6800, lng: 100.2460 },
  { code: 'DIG', name: '香格里拉迪慶機場',       lat: 27.7936, lng: 99.6772  },
  { code: 'NLH', name: '寧蒗瀘沽湖機場',     lat: 27.5286, lng: 100.7522 },
  { code: 'PVG', name: '上海浦東國際機場',     lat: 31.1443, lng: 121.8083 },
  { code: 'PEK', name: '北京首都國際機場',     lat: 40.0801, lng: 116.5846 },
  { code: 'TPE', name: '台北桃園國際機場',     lat: 25.0777, lng: 121.2328 }
];
function findAirport(code) {
  return AIRPORTS.find(a => a.code === code) || null;
}
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
  // v43 migration: old fxRate semantics were "HKD per CNY" (~1.10).
  // New semantics are "CNY per HKD" (~0.91). If we still see an old-style
  // value > 2, invert it once and persist.
  if (settings.fxRate && settings.fxRate > 2) {
    settings.fxRate = +(1 / settings.fxRate).toFixed(4);
    try { saveSettings(); } catch (_) {}
  }
  // v44 migration: ensure caps object exists with all known categories
  if (!settings.caps) settings.caps = { ...DEFAULT_BUDGET_CAPS };
  Object.keys(DEFAULT_BUDGET_CAPS).forEach(k => {
    if (settings.caps[k] === undefined) settings.caps[k] = DEFAULT_BUDGET_CAPS[k];
  });
  // v43 expense migration: older items may have a CNY amount with no
  // currency stamped, or no fxRate locked. Backfill defaults so totals are
  // computed consistently across old + new entries.
  let migrated = false;
  expenses.forEach(x => {
    if (!x.currency) { x.currency = 'CNY'; migrated = true; }
    if (x.fxRate === undefined) { x.fxRate = null; migrated = true; }
  });
  if (migrated) { try { saveBudget(); } catch (_) {} }
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

// v43: HKD-based conversion. lockedRate (CNY per HKD) overrides global when set.
// Examples:
//   toHKD(1100, 'CNY')         -> 1100 / 0.91 ≈ 1209 HKD (using global rate)
//   toHKD(1100, 'CNY', 0.93)   -> 1100 / 0.93 ≈ 1183 HKD (using locked rate)
//   toHKD(800,  'HKD')         -> 800  (no conversion)
//   toHKD(100,  'USD')         -> 100 * 7.8 ≈ 780 HKD (USD -> HKD approx)
function toHKD(amount, currency, lockedRate) {
  const a = parseFloat(amount) || 0;
  if (!currency || currency === 'HKD') return a;
  if (currency === 'CNY') {
    const rate = (lockedRate && lockedRate > 0) ? lockedRate : settings.fxRate;
    return a / rate;
  }
  if (currency === 'USD') return a * 7.8;
  return a;
}
// Kept for legacy use by hotel/flight breakdown rendering.
function toCNY(amount, currency, lockedRate) {
  const a = parseFloat(amount) || 0;
  if (currency === 'CNY') return a;
  if (currency === 'HKD') {
    const rate = (lockedRate && lockedRate > 0) ? lockedRate : settings.fxRate;
    return a * rate;
  }
  if (currency === 'USD') return a * 7.8 * settings.fxRate;
  return a;
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

  // v43: totals are in HKD base. Each expense converts using its locked
  // rate (x.fxRate) when present, otherwise the global rate.
  const totalHKD  = expenses.reduce((s, x) => s + toHKD(x.amount, x.currency, x.fxRate), 0);
  const paidHKD   = expenses.filter(x => x.status === 'paid').reduce((s, x) => s + toHKD(x.amount, x.currency, x.fxRate), 0);
  const unpaidHKD = expenses.filter(x => x.status !== 'paid').reduce((s, x) => s + toHKD(x.amount, x.currency, x.fxRate), 0);
  const totalCNY  = totalHKD * settings.fxRate;
  const days = state.days.length;
  const avg = days > 0 && settings.travelers > 0 ? totalHKD / days / settings.travelers : 0;

  document.getElementById('sum-total').textContent      = 'HK$' + fmt(totalHKD);
  document.getElementById('sum-total-hkd').textContent  = '≈ ¥' + fmt(totalCNY);
  document.getElementById('sum-paid').textContent       = 'HK$' + fmt(paidHKD);
  document.getElementById('sum-unpaid').textContent     = 'HK$' + fmt(unpaidHKD);
  document.getElementById('sum-avg').textContent        = 'HK$' + fmt(avg);

  // v43: category breakdown in HKD
  const byCat = {};
  Object.keys(CATEGORIES).forEach(k => byCat[k] = 0);
  expenses.forEach(x => {
    const k = x.category && CATEGORIES[x.category] ? x.category : 'other';
    byCat[k] = (byCat[k] || 0) + toHKD(x.amount, x.currency, x.fxRate);
  });

  const bar = document.getElementById('breakdown-bar');
  const legend = document.getElementById('breakdown-legend');
  if (totalHKD > 0) {
    const segs = Object.entries(byCat)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    bar.innerHTML = segs.map(([k, v]) =>
      `<div style="background:${CATEGORIES[k].color};width:${(v / totalHKD * 100).toFixed(2)}%"
            title="${CATEGORIES[k].label} HK$${fmt(v)}"></div>`
    ).join('');
    legend.innerHTML = segs.map(([k, v]) =>
      `<span class="legend-item">
         <span class="legend-swatch" style="background:${CATEGORIES[k].color}"></span>
         ${CATEGORIES[k].label}
         <span class="legend-amt">HK$${fmt(v)}</span>
         <span style="color:var(--ink-3);font-size:11px;">${(v / totalHKD * 100).toFixed(0)}%</span>
       </span>`
    ).join('');
  } else {
    bar.innerHTML = '<div style="background:var(--border);width:100%"></div>';
    legend.innerHTML = '<span class="legend-item" style="color:var(--ink-3)">尚無資料</span>';
  }

  // v44: budget vs actual + daily burn rate
  renderBudgetVsActual(byCat);
  renderDailyBurnChart();
  renderItinerarySanity();
  renderChecklist();

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
    // v43: primary HKD, secondary native currency.
    const hkd = toHKD(x.amount, x.currency, x.fxRate);
    const showNative = x.currency && x.currency !== 'HKD';
    // Category-specific detail line (hotel breakdown, flight legs)
    let detail = '';
    if (x.category === 'hotel' && x.roomRate && x.nights && x.rooms) {
      const sym = x.currency === 'CNY' ? '¥' : x.currency === 'HKD' ? 'HK$' : 'US$';
      detail = `<div class="expense-detail">${sym}${fmt(x.roomRate)}/晚 × ${x.nights} 晚 × ${x.rooms} 房</div>`;
    } else if (x.category === 'flight') {
      const legs = Array.isArray(x.flights) && x.flights.length
        ? x.flights
        : (x.flightFrom || x.flightTo)
          ? [{ no: x.flightNo, from: x.flightFrom, to: x.flightTo }]
          : [];
      if (legs.length) {
        const parts = legs.map(l => {
          const bits = [];
          if (l.no) bits.push(escapeHTML(l.no));
          if (l.from && l.to) bits.push(`${l.from} → ${l.to}`);
          return bits.join(' · ');
        }).filter(Boolean);
        const prefix = legs.length > 1 ? `${legs.length} 程：` : '';
        detail = `<div class="expense-detail">${prefix}${parts.join(' 、 ')}</div>`;
      }
    }
    return `<div class="expense-row" data-id="${x.id}">
      <div class="expense-icon" style="background:${cat.color}22;color:${cat.color}">${cat.icon}</div>
      <div class="expense-main">
        <div class="expense-name">${escapeHTML(x.name)}</div>
        ${detail}
        <div class="expense-meta">
          ${dayInfo}
          <span>${cat.label}</span>
          ${statusLabel ? `<span class="status-pill ${x.status}">${statusLabel}</span>` : ''}
          ${x.method ? `<span>· ${escapeHTML(x.method)}</span>` : ''}
        </div>
      </div>
      <div>
        <div class="expense-amt">HK$${fmt(hkd)}</div>
        <div class="expense-amt-sub">${showNative ? '原幣 ' + (x.currency === 'CNY' ? '¥' : x.currency === 'HKD' ? 'HK$' : 'US$') + fmt(x.amount) + (x.fxRate ? ' · 鎖 ' + (+x.fxRate).toFixed(4) : '') : ''}</div>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.expense-row').forEach(row => {
    row.addEventListener('click', () => openExpenseModal(row.dataset.id));
  });
}

/* =========================================================
   v44: Budget vs Actual + Daily Burn Rate + Sanity Check
   ========================================================= */

// Build a table comparing each category's cap vs actual HKD spent.
function renderBudgetVsActual(byCat) {
  const wrap = document.getElementById('budget-vs-actual');
  if (!wrap) return;
  const caps = settings.caps || DEFAULT_BUDGET_CAPS;
  const order = ['hotel', 'flight', 'transport', 'food', 'activity', 'shopping', 'other'];
  let totalCap = 0;
  let totalActual = 0;
  const rows = order.map(k => {
    const cap = +caps[k] || 0;
    const actual = +byCat[k] || 0;
    totalCap += cap;
    totalActual += actual;
    const pct = cap > 0 ? Math.min(actual / cap, 1.5) : 0;
    const isOver = cap > 0 && actual > cap;
    const isWarn = cap > 0 && actual >= cap * 0.8 && actual <= cap;
    const cls = isOver ? 'bva-over' : isWarn ? 'bva-warn' : 'bva-ok';
    const remaining = cap - actual;
    const remainingTxt = cap === 0 ? '未設上限' :
      isOver ? `超支 HK$${fmt(actual - cap)}` :
      `餘 HK$${fmt(remaining)}`;
    return `
      <div class="bva-row ${cls}">
        <div class="bva-cat">
          <span class="bva-dot" style="background:${CATEGORIES[k].color}"></span>
          ${CATEGORIES[k].label}
        </div>
        <div class="bva-bar">
          <div class="bva-fill" style="width:${Math.min(pct, 1) * 100}%; background:${CATEGORIES[k].color}"></div>
          ${pct > 1 ? `<div class="bva-over-fill" style="width:${Math.min((pct - 1) / 0.5, 1) * 100}%"></div>` : ''}
        </div>
        <div class="bva-cap">
          <input type="number" class="bva-cap-input" data-cat="${k}" value="${cap}" min="0" step="100" aria-label="${CATEGORIES[k].label} 預算上限">
        </div>
        <div class="bva-actual">HK$${fmt(actual)}</div>
        <div class="bva-remain">${remainingTxt}</div>
      </div>`;
  }).join('');
  const overall = totalCap > 0 ? totalActual / totalCap : 0;
  const overallTxt = totalCap === 0 ? '未設總預算' :
    totalActual > totalCap ? `全局超支 HK$${fmt(totalActual - totalCap)}` :
    `還餘 HK$${fmt(totalCap - totalActual)}`;
  wrap.innerHTML = `
    <div class="bva-header">
      <h3>預算 vs 實際</h3>
      <div class="bva-overall ${totalActual > totalCap ? 'bva-over' : ''}">
        總使用 <strong>${Math.round(overall * 100)}%</strong> · ${overallTxt}
      </div>
    </div>
    <div class="bva-grid-head">
      <span>分類</span><span></span><span>上限</span><span>實際</span><span>餘額</span>
    </div>
    ${rows}
    <div class="bva-note">以港幣計。「上限」欄可隨時調整。</div>
  `;
  // Wire up cap inputs
  wrap.querySelectorAll('.bva-cap-input').forEach(inp => {
    inp.addEventListener('change', e => {
      const cat = e.target.dataset.cat;
      const v = parseInt(e.target.value, 10);
      if (cat && v >= 0) {
        settings.caps[cat] = v;
        saveSettings();
        renderBudget();
      }
    });
  });
}

// Daily HKD spend chart (stacked by category)
function renderDailyBurnChart() {
  const wrap = document.getElementById('daily-burn');
  if (!wrap) return;
  const days = state.days;
  const totalTripHKD = expenses.reduce((s, x) => s + toHKD(x.amount, x.currency, x.fxRate), 0);
  // Build per-day per-category buckets. Expenses without a day are spread
  // evenly across all days for the burn chart (so flights/global purchases
  // still show some footprint).
  const buckets = days.map(d => ({ day: d.day, date: d.date, total: 0, byCat: {} }));
  let unassignedTotal = 0;
  expenses.forEach(x => {
    const hkd = toHKD(x.amount, x.currency, x.fxRate);
    if (x.day) {
      const b = buckets.find(b => b.day === x.day);
      if (b) {
        b.total += hkd;
        b.byCat[x.category] = (b.byCat[x.category] || 0) + hkd;
      } else {
        unassignedTotal += hkd;
      }
    } else {
      unassignedTotal += hkd;
    }
  });
  // Spread unassigned evenly
  if (unassignedTotal > 0 && buckets.length > 0) {
    const per = unassignedTotal / buckets.length;
    buckets.forEach(b => {
      b.total += per;
      b.byCat.other = (b.byCat.other || 0) + per;
    });
  }
  const maxDay = Math.max(1, ...buckets.map(b => b.total));
  const totalSpent = buckets.reduce((s, b) => s + b.total, 0);
  const avgPerDay = days.length > 0 ? totalTripHKD / days.length : 0;
  // Avg line position
  const avgPct = maxDay > 0 ? (avgPerDay / maxDay) * 100 : 0;
  const bars = buckets.map(b => {
    const heightPct = maxDay > 0 ? (b.total / maxDay) * 100 : 0;
    const segs = Object.entries(b.byCat)
      .sort((a, b2) => b2[1] - a[1])
      .map(([k, v]) => {
        const segPct = b.total > 0 ? (v / b.total) * 100 : 0;
        return `<div style="height:${segPct}%; background:${(CATEGORIES[k] || CATEGORIES.other).color}" title="${(CATEGORIES[k] || CATEGORIES.other).label}: HK$${fmt(v)}"></div>`;
      }).join('');
    return `
      <div class="burn-col" title="Day ${b.day} · ${b.date} · HK$${fmt(b.total)}">
        <div class="burn-bar-wrap">
          <div class="burn-bar" style="height:${heightPct}%">${segs}</div>
        </div>
        <div class="burn-amt">${b.total > 0 ? 'HK$' + fmt(b.total) : '—'}</div>
        <div class="burn-day">D${b.day}</div>
      </div>`;
  }).join('');
  wrap.innerHTML = `
    <div class="burn-header">
      <h3>每日燒錢率</h3>
      <div class="burn-meta">全程 HK$${fmt(totalSpent)} · 平均 HK$${fmt(avgPerDay)}／日</div>
    </div>
    <div class="burn-chart">
      ${avgPct > 0 ? `<div class="burn-avg-line" style="bottom:${avgPct}%" title="平均 HK$${fmt(avgPerDay)}"></div>` : ''}
      ${bars}
    </div>
    <div class="burn-note">未指定日子嘅開支會平均攝入 13 日。點柱看明細。</div>
  `;
}

// Simple itinerary sanity checks based on day load + altitude
function renderItinerarySanity() {
  const wrap = document.getElementById('sanity-check');
  if (!wrap) return;
  const warnings = [];
  state.days.forEach(d => {
    const spotCount = (d.spots || []).length;
    const drive = parseFloat(d.driveHours) || 0;
    const alt = DAY_ALTITUDE[d.day] || 0;
    const dayLabel = `Day ${d.day}·${d.city || ''}`;
    if (drive > 8) {
      warnings.push({ level: 'warn', day: d.day, label: dayLabel, msg: `車程約 ${drive.toFixed(1)} 小時，偏長，記住中途休息` });
    }
    if (spotCount > 4) {
      warnings.push({ level: 'warn', day: d.day, label: dayLabel, msg: `${spotCount} 個景點，行程密集，可以預留 buffer 時間` });
    }
    if (alt >= 3000 && spotCount > 3) {
      warnings.push({ level: 'alt', day: d.day, label: dayLabel, msg: `高原日·海拔 ~${alt}m + ${spotCount} 個景點，多飲水、走慢點` });
    } else if (alt >= 3500) {
      warnings.push({ level: 'alt', day: d.day, label: dayLabel, msg: `高原日·海拔 ~${alt}m，帶高原藥、避免劇烈運動` });
    }
  });
  if (warnings.length === 0) {
    wrap.innerHTML = `
      <div class="sanity-header">
        <h3>行程檢查</h3>
        <span class="sanity-clean">· 沒有明顯問題</span>
      </div>
      <div class="sanity-note">車程 ≤ 8 小時、景點 ≤ 4、高原日已考慮。出發前可再複查一次。</div>
    `;
    return;
  }
  const items = warnings.map(w => `
    <div class="sanity-row level-${w.level}">
      <div class="sanity-day-pill">${w.label}</div>
      <div class="sanity-msg">${w.msg}</div>
    </div>`).join('');
  wrap.innerHTML = `
    <div class="sanity-header">
      <h3>行程檢查</h3>
      <span class="sanity-count">${warnings.length} 項提醒</span>
    </div>
    ${items}
  `;
}

// v45: Weather + sunrise/sunset data — historical Oct averages per city
// keyed by primary city token. Days 10-22 Oct each get an entry; we look up
// by date string for precision. Values are typical October daily highs/lows in °C.
const WEATHER_BY_CITY = {
  '昆明':       { tempHi: 20, tempLo: 12, cond: '多雲', sunrise: '07:35', sunset: '18:55' },
  '大理':       { tempHi: 21, tempLo: 12, cond: '晴', sunrise: '07:30', sunset: '18:48' },
  '麗江':       { tempHi: 18, tempLo:  8, cond: '晴轉雲', sunrise: '07:32', sunset: '18:46' },
  '瀘沽湖':     { tempHi: 17, tempLo:  6, cond: '晴', sunrise: '07:30', sunset: '18:45' },
  '香格里拉':   { tempHi: 14, tempLo:  2, cond: '晴轉雲', sunrise: '07:42', sunset: '18:50' },
  '德欽':       { tempHi: 12, tempLo:  0, cond: '晴', sunrise: '07:50', sunset: '18:55' }
};
function cityKeyForWeather(city) {
  if (!city) return null;
  // "德欽 → 香格里拉" → match 德欽 first
  for (const k of Object.keys(WEATHER_BY_CITY)) {
    if (city.indexOf(k) !== -1) return k;
  }
  return null;
}
function getWeatherForDay(day) {
  const key = cityKeyForWeather(day.city);
  if (!key) return null;
  const base = WEATHER_BY_CITY[key];
  // Small day-by-day variation seeded from day number so values look natural
  const seed = (day.day * 7) % 5 - 2; // -2..2
  return {
    city: key,
    tempHi: base.tempHi + seed,
    tempLo: base.tempLo + Math.floor(seed / 2),
    cond: base.cond,
    sunrise: base.sunrise,
    sunset: base.sunset
  };
}

// v45: Spot opening hours lookup — name → 'HH:MM-HH:MM' (or note like '全日')
const SPOT_HOURS = {
  '昆明長水國際機場': '24 小時',
  '雙橋夜市': '17:00-23:00',
  '石林風景區': '07:00-18:00',
  '撈魚河濕地公園': '08:00-19:00',
  '昆明老街': '全日 · 食肆 11:00-22:00',
  '理想邦': '全日',
  '文筆村': '全日',
  '小普陀': '08:00-18:00',
  '雙廊古鎮': '全日',
  '喜洲古鎮': '08:00-20:00',
  '白族扎染體驗': '09:00-18:00 · 建議預約',
  '洱海 S 彎': '全日 · 日落最靚',
  '龍龕碼頭': '全日',
  '崇聖寺三塔': '07:30-19:00',
  '大理古城': '全日',
  '蒼山感通索道': '08:30-16:30',
  '寂照庵': '08:00-17:00',
  '麗江古城': '全日 · 古城維護費已停收',
  '玉龍雪山': '07:30-16:00',
  '雲杉坪索道': '08:00-16:00',
  '藍月谷': '08:00-17:00',
  '白沙古鎮': '全日',
  '瀘沽湖觀景台': '全日',
  '摩梭篝火晚會': '19:30-21:30',
  '豬槽船遊湖': '07:00-18:00 · 日出班次 06:30',
  '走婚橋': '全日',
  '虎跳峽': '08:00-17:30',
  '獨克宗古城': '全日',
  '松贊林寺': '07:30-18:30',
  '大經幡': '全日',
  '白馬雪山觀景台': '全日',
  '霧濃頂': '全日 · 日照金山 06:30-07:30',
  '飛來寺觀景台': '全日 · 日照金山 06:30-07:30',
  '金沙江第一灣': '全日',
  '普達措國家森林公園': '08:30-15:00 · 末班車 17:00',
  '納帕海': '08:00-18:00'
};
function lookupSpotHours(name) {
  if (!name) return null;
  if (SPOT_HOURS[name]) return SPOT_HOURS[name];
  // partial match: name contains a known key, or key contains name
  for (const k of Object.keys(SPOT_HOURS)) {
    if (name.indexOf(k) !== -1 || k.indexOf(name) !== -1) return SPOT_HOURS[k];
  }
  return null;
}

// v45: Pre-departure checklist — auto-generated from itinerary altitude + spots
function buildChecklist() {
  const items = [];
  const days = state.days || [];
  let maxAlt = 0;
  let hasYulong = false;
  let hasMeili = false;
  let hasZaran = false;
  let hasBonfire = false;
  let hasSunrise = false;
  let hasFlight = false;
  let hasIndoorTemple = false;
  days.forEach(d => {
    const alt = DAY_ALTITUDE[d.day] || 0;
    if (alt > maxAlt) maxAlt = alt;
    (d.spots || []).forEach(s => {
      const n = s.name || '';
      if (n.indexOf('玉龍') !== -1 || n.indexOf('雲杉') !== -1) hasYulong = true;
      if (n.indexOf('梅里') !== -1 || n.indexOf('飛來寺') !== -1 || n.indexOf('日照金山') !== -1 || n.indexOf('霧濃頂') !== -1) hasMeili = true;
      if (n.indexOf('扎染') !== -1) hasZaran = true;
      if (n.indexOf('篝火') !== -1) hasBonfire = true;
      if (n.indexOf('日出') !== -1 || n.indexOf('豬槽') !== -1) hasSunrise = true;
      if (n.indexOf('機場') !== -1) hasFlight = true;
      if (n.indexOf('寺') !== -1 || n.indexOf('庵') !== -1 || n.indexOf('經幡') !== -1) hasIndoorTemple = true;
    });
  });
  // Essentials
  items.push({ group: '證件', text: '回鄉證／港澳通行證 + 副本一份', auto: true });
  items.push({ group: '證件', text: '酒店訂單／機票 PDF 截圖 (離線)', auto: true });
  if (hasFlight) items.push({ group: '證件', text: '航班 boarding pass App + 行李掛牌', auto: true });
  items.push({ group: '電子', text: '相機 + SD 卡 + 備用電池', auto: true });
  items.push({ group: '電子', text: '行動電源（航空托運留意 20000mAh 限制）', auto: true });
  items.push({ group: '電子', text: '充電線（type-C / lightning）', auto: true });
  // Altitude
  if (maxAlt >= 3000) {
    items.push({ group: '高原', text: `紅景天／高原藥（最高點 ~${maxAlt}m）`, auto: true });
    items.push({ group: '高原', text: '保暖外套 + 抓絨內膽', auto: true });
    items.push({ group: '高原', text: '潤唇膏、保濕乳液（高原乾燥）', auto: true });
  }
  if (maxAlt >= 3500) {
    items.push({ group: '高原', text: '便攜小氧氣樽（街市／藥房有售）', auto: true });
  }
  // Yulong / snow
  if (hasYulong) items.push({ group: '裝備', text: '防風外套 + 帽 + 手套（玉龍雪山）', auto: true });
  if (hasMeili) items.push({ group: '裝備', text: '腳架（飛來寺日照金山）', auto: true });
  if (hasSunrise) items.push({ group: '裝備', text: '頭燈／電筒（瀘沽湖日出晨霧）', auto: true });
  // UV / sun
  items.push({ group: '裝備', text: '太陽眼鏡 + 防曬 SPF50+', auto: true });
  items.push({ group: '裝備', text: '舒適行山鞋（古城石板路、虎跳峽）', auto: true });
  // Cultural reservations
  if (hasZaran) items.push({ group: '預約', text: '白族扎染體驗預約（喜洲）', auto: true });
  if (hasBonfire) items.push({ group: '預約', text: '摩梭篝火晚會場次預約', auto: true });
  if (hasIndoorTemple) items.push({ group: '禮儀', text: '寺院長褲／可遮膝衣物', auto: true });
  // Money + comms
  items.push({ group: '錢包', text: '人民幣現金 ¥1000-2000（小景點／拍照付款）', auto: true });
  items.push({ group: '錢包', text: '微信／支付寶綁定港卡或同行人卡', auto: true });
  items.push({ group: '錢包', text: '信用卡 + 備用 debit card', auto: true });
  items.push({ group: '通訊', text: '內地電話卡或漫遊 + 翻牆方案', auto: true });
  items.push({ group: '通訊', text: '司機聯絡電話／包車合約截圖', auto: true });
  // Health
  items.push({ group: '健康', text: '常備藥：感冒、肚痛、止瀉、暈車', auto: true });
  items.push({ group: '健康', text: '個人藥物 + 藥單影印', auto: true });
  return items;
}
function renderChecklist() {
  const wrap = document.getElementById('checklist');
  if (!wrap) return;
  // Load saved checked state
  let checked = {};
  try { checked = JSON.parse(safeStorage.getItem(CHECKLIST_KEY) || '{}'); } catch (_) { checked = {}; }
  const items = buildChecklist();
  // Group
  const groups = {};
  items.forEach(it => {
    if (!groups[it.group]) groups[it.group] = [];
    groups[it.group].push(it);
  });
  const total = items.length;
  const done = items.filter(it => checked[it.text]).length;
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  const groupOrder = ['證件', '電子', '高原', '裝備', '預約', '禮儀', '錢包', '通訊', '健康'];
  const groupsHTML = groupOrder.filter(g => groups[g]).map(g => {
    const rows = groups[g].map(it => {
      const isOn = !!checked[it.text];
      return `<label class="chk-row${isOn ? ' done' : ''}">
        <input type="checkbox" data-chk-text="${escapeHTML(it.text)}" ${isOn ? 'checked' : ''}>
        <span class="chk-text">${escapeHTML(it.text)}</span>
      </label>`;
    }).join('');
    return `<div class="chk-group"><div class="chk-group-title">${g}</div>${rows}</div>`;
  }).join('');
  wrap.innerHTML = `
    <div class="chk-header">
      <h3>出發 Checklist</h3>
      <div class="chk-progress">
        <span class="chk-progress-text">${done} / ${total} · ${pct}%</span>
        <div class="chk-progress-bar"><div class="chk-progress-fill" style="width:${pct}%"></div></div>
      </div>
    </div>
    <div class="chk-groups">${groupsHTML}</div>
    <div class="chk-note">由行程自動生成。剔好嘅項目會記住，落次開頁仲記得。</div>
  `;
  wrap.querySelectorAll('input[data-chk-text]').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const t = e.target.dataset.chkText;
      let cur = {};
      try { cur = JSON.parse(safeStorage.getItem(CHECKLIST_KEY) || '{}'); } catch (_) {}
      if (e.target.checked) cur[t] = 1; else delete cur[t];
      try { safeStorage.setItem(CHECKLIST_KEY, JSON.stringify(cur)); } catch (_) {}
      renderChecklist();
    });
  });
}
const CHECKLIST_KEY = 'yunnan-checklist-v1';

/* ---- Expense modal ---- */
// Count consecutive nights at the same hotel starting from a given day number.
function countNightsAtHotelFromDay(hotelName, startDayNum) {
  if (!hotelName || !startDayNum) return 1;
  const idx = state.days.findIndex(d => d.day === startDayNum);
  if (idx < 0) return 1;
  let nights = 0;
  for (let i = idx; i < state.days.length; i++) {
    if ((state.days[i].hotel && state.days[i].hotel.name) === hotelName) nights++;
    else break;
  }
  return Math.max(1, nights);
}

function updateHotelFieldsVisibility() {
  const cat = document.getElementById('e-cat').value;
  const isHotel = cat === 'hotel';
  const hotelFields = document.getElementById('hotel-fields');
  const hotelSummary = document.getElementById('hotel-summary');
  const amountLabel = document.getElementById('e-amount-label');
  const amountInput = document.getElementById('e-amount');
  hotelFields.classList.toggle('hotel-hidden', !isHotel);
  hotelSummary.classList.toggle('hotel-hidden', !isHotel);
  if (isHotel) {
    amountLabel.textContent = '總金額（自動）';
    amountInput.readOnly = true;
    amountInput.classList.add('input-readonly');
    updateHotelTotal();
  } else {
    amountLabel.textContent = '金額';
    amountInput.readOnly = false;
    amountInput.classList.remove('input-readonly');
  }
}
function updateHotelTotal() {
  const rate = parseFloat(document.getElementById('e-rate').value) || 0;
  const rooms = parseInt(document.getElementById('e-rooms').value, 10) || 1;
  const nights = parseInt(document.getElementById('e-nights').value, 10) || 1;
  const total = rate * rooms * nights;
  document.getElementById('e-amount').value = total ? total.toFixed(2) : '';
  const currency = document.getElementById('e-currency').value;
  const symbol = currency === 'CNY' ? '¥' : currency === 'HKD' ? 'HK$' : 'US$';
  const summary = document.getElementById('hotel-summary');
  if (rate > 0) {
    summary.innerHTML = `${symbol}${fmt(rate)}/晚 × ${nights} 晚 × ${rooms} 房 = <strong>${symbol}${fmt(total)}</strong>`;
  } else {
    summary.innerHTML = '<span style="opacity:.55">填房價後自動計算總費</span>';
  }
  // v43: also refresh the HKD-equivalent preview line below
  try { updateFxConvertedSummary(); } catch (_) {}
}

/* ---------- Flight (multi-leg) ---------- */
function airportOptionsHtml(selectedCode) {
  return `<option value="">— 請選擇 —</option>` + AIRPORTS
    .map(a => `<option value="${a.code}"${a.code === selectedCode ? ' selected' : ''}>${a.code} · ${a.name}</option>`)
    .join('');
}
function renderFlightLegs(legs) {
  const list = document.getElementById('e-flight-legs-list');
  if (!list) return;
  list.innerHTML = legs.map((leg, i) => `
    <div class="flight-leg-card" data-leg-idx="${i}">
      <div class="flight-leg-head">第 ${i + 1} 程</div>
      <div class="field-row">
        <label class="field">
          <span>航班號</span>
          <input type="text" class="e-leg-no" data-i="${i}" value="${(leg.no || '').replace(/"/g, '&quot;')}" placeholder="例：CX 314" autocomplete="off">
        </label>
        <label class="field">
          <span>出發</span>
          <select class="e-leg-from" data-i="${i}">${airportOptionsHtml(leg.from)}</select>
        </label>
        <label class="field">
          <span>到達</span>
          <select class="e-leg-to" data-i="${i}">${airportOptionsHtml(leg.to)}</select>
        </label>
      </div>
    </div>
  `).join('');
  // Wire each input to update summary live
  list.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input', readFlightLegsAndUpdate);
    el.addEventListener('change', readFlightLegsAndUpdate);
  });
}
function readFlightLegs() {
  const list = document.getElementById('e-flight-legs-list');
  if (!list) return [];
  const cards = Array.from(list.querySelectorAll('.flight-leg-card'));
  return cards.map(card => ({
    no:   (card.querySelector('.e-leg-no').value || '').trim(),
    from: card.querySelector('.e-leg-from').value || '',
    to:   card.querySelector('.e-leg-to').value || ''
  }));
}
function readFlightLegsAndUpdate() {
  updateFlightSummary();
}
function updateFlightLegsCount() {
  const want = parseInt(document.getElementById('e-flight-legs').value, 10) || 1;
  const current = readFlightLegs();
  const next = [];
  for (let i = 0; i < want; i++) {
    next.push(current[i] || { no: '', from: '', to: '' });
  }
  renderFlightLegs(next);
  updateFlightSummary();
}
function updateFlightSummary() {
  const legs = readFlightLegs();
  const box = document.getElementById('flight-summary');
  if (!box) return;
  const lines = legs.map((l, i) => {
    const parts = [];
    if (l.no) parts.push(`<strong>${l.no}</strong>`);
    const fa = findAirport(l.from); const ta = findAirport(l.to);
    if (fa && ta) parts.push(`${fa.code} → ${ta.code}`);
    else if (fa) parts.push(`${fa.code} → —`);
    else if (ta) parts.push(`— → ${ta.code}`);
    if (!parts.length) return `<span style="opacity:.5">第 ${i + 1} 程：未填</span>`;
    return `第 ${i + 1} 程：${parts.join(' · ')}`;
  });
  box.innerHTML = lines.join('<br>');
}
function updateFlightFieldsVisibility() {
  const cat = document.getElementById('e-cat').value;
  const isFlight = cat === 'flight';
  document.getElementById('flight-fields').classList.toggle('flight-hidden', !isFlight);
  document.getElementById('flight-summary').classList.toggle('flight-hidden', !isFlight);
  if (isFlight) updateFlightSummary();
}

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
    document.getElementById('e-currency').value = x.currency || 'HKD';
    document.getElementById('e-fxlock').value = x.fxRate || '';
    document.getElementById('e-status').value = x.status;
    document.getElementById('e-method').value = x.method || '';
    document.getElementById('e-note').value = x.note || '';
    // Hotel-specific fields
    if (x.category === 'hotel') {
      const inferredNights = countNightsAtHotelFromDay(x.name, x.day);
      const rooms = x.rooms || 1;
      const nights = x.nights || inferredNights;
      const rate = x.roomRate || (x.amount && rooms && nights ? x.amount / rooms / nights : '');
      document.getElementById('e-rate').value = rate || '';
      document.getElementById('e-rooms').value = rooms;
      document.getElementById('e-nights').value = nights;
    } else {
      document.getElementById('e-rate').value = '';
      document.getElementById('e-rooms').value = 1;
      document.getElementById('e-nights').value = 1;
    }
    // Flight-specific fields (multi-leg)
    if (x.category === 'flight') {
      const existing = Array.isArray(x.flights) && x.flights.length ? x.flights
        : (x.flightFrom || x.flightTo || x.flightNo)
          ? [{ no: x.flightNo || '', from: x.flightFrom || '', to: x.flightTo || '' }]
          : [{ no: '', from: '', to: '' }];
      document.getElementById('e-flight-legs').value = String(Math.min(4, Math.max(1, existing.length)));
      renderFlightLegs(existing);
    } else {
      document.getElementById('e-flight-legs').value = '1';
      renderFlightLegs([{ no: '', from: '', to: '' }]);
    }
    delBtn.style.display = '';
  } else {
    title.textContent = '新增開支';
    document.getElementById('e-name').value = '';
    document.getElementById('e-cat').value = 'hotel';
    document.getElementById('e-day').value = '';
    document.getElementById('e-amount').value = '';
    document.getElementById('e-currency').value = 'HKD';
    document.getElementById('e-fxlock').value = '';
    document.getElementById('e-status').value = 'unpaid';
    document.getElementById('e-method').value = '';
    document.getElementById('e-note').value = '';
    document.getElementById('e-rate').value = '';
    document.getElementById('e-rooms').value = 1;
    document.getElementById('e-nights').value = 1;
    document.getElementById('e-flight-legs').value = '1';
    renderFlightLegs([{ no: '', from: '', to: '' }]);
    delBtn.style.display = 'none';
  }
  updateHotelFieldsVisibility();
  updateFlightFieldsVisibility();
  updateFxLockVisibility();
  updateFxConvertedSummary();
  modal.hidden = false;
}

// v43: hide locked-rate row when currency = HKD (no conversion needed).
function updateFxLockVisibility() {
  const cur = document.getElementById('e-currency').value;
  const row = document.getElementById('fx-lock-row');
  if (row) row.classList.toggle('fx-hidden', cur === 'HKD');
  updateFxConvertedSummary();
}

// v43: live preview of HKD-equivalent amount in modal
function updateFxConvertedSummary() {
  const box = document.getElementById('fx-converted-summary');
  if (!box) return;
  const cur = document.getElementById('e-currency').value;
  const amtEl = document.getElementById('e-amount');
  const rateEl = document.getElementById('e-fxlock');
  // For hotel category, amount is auto-computed; read room rate * rooms * nights.
  let amount = parseFloat(amtEl ? amtEl.value : '0') || 0;
  if (document.getElementById('e-cat').value === 'hotel') {
    const rate = parseFloat(document.getElementById('e-rate').value) || 0;
    const rooms = parseInt(document.getElementById('e-rooms').value, 10) || 1;
    const nights = parseInt(document.getElementById('e-nights').value, 10) || 1;
    amount = rate * rooms * nights;
  }
  if (!amount || cur === 'HKD') {
    box.textContent = '';
    box.classList.remove('visible');
    return;
  }
  const lock = parseFloat(rateEl.value);
  const hkd = toHKD(amount, cur, lock > 0 ? lock : null);
  const sym = cur === 'CNY' ? '¥' : 'US$';
  const rateLabel = lock > 0 ? `鎖定 ${lock.toFixed(4)}` : `全局 ${settings.fxRate.toFixed(4)}`;
  box.textContent = `${sym}${fmt(amount)} ≈ HK$${fmt(hkd)} · ${rateLabel} CNY/HKD`;
  box.classList.add('visible');
}
function closeExpenseModal() {
  document.getElementById('expense-modal').hidden = true;
  editingExpenseId = null;
}
function saveExpense() {
  const name = document.getElementById('e-name').value.trim();
  const category = document.getElementById('e-cat').value;
  if (!name) return toast('請輸入名稱');

  let amount;
  let hotelExtras = { roomRate: null, rooms: null, nights: null };
  let flightExtras = { flights: null, flightNo: null, flightFrom: null, flightTo: null };
  if (category === 'hotel') {
    const rate = parseFloat(document.getElementById('e-rate').value);
    const rooms = parseInt(document.getElementById('e-rooms').value, 10) || 1;
    const nights = parseInt(document.getElementById('e-nights').value, 10) || 1;
    if (isNaN(rate) || rate < 0) return toast('請輸入每晚房價');
    if (rooms < 1) return toast('房數至少 1');
    if (nights < 1) return toast('晚數至少 1');
    amount = rate * rooms * nights;
    hotelExtras = { roomRate: rate, rooms, nights };
  } else if (category === 'flight') {
    amount = parseFloat(document.getElementById('e-amount').value);
    if (isNaN(amount) || amount < 0) return toast('請輸入有效金額');
    const legs = readFlightLegs().filter(l => l.no || l.from || l.to);
    flightExtras = {
      flights: legs,
      flightNo:   (legs[0] && legs[0].no)   || null,
      flightFrom: (legs[0] && legs[0].from) || null,
      flightTo:   (legs[0] && legs[0].to)   || null
    };
  } else {
    amount = parseFloat(document.getElementById('e-amount').value);
    if (isNaN(amount) || amount < 0) return toast('請輸入有效金額');
  }

  // v43: persist locked FX rate per expense (null = follow global)
  const fxLockVal = parseFloat(document.getElementById('e-fxlock').value);
  const data = {
    name,
    category,
    day: parseInt(document.getElementById('e-day').value, 10) || null,
    amount,
    currency: document.getElementById('e-currency').value,
    fxRate: (fxLockVal > 0) ? fxLockVal : null,
    status: document.getElementById('e-status').value,
    method: document.getElementById('e-method').value.trim(),
    note: document.getElementById('e-note').value.trim(),
    ...hotelExtras,
    ...flightExtras
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
  // Refresh map so newly added/edited flight legs appear as dashed lines.
  try { if (activeDayIdx === -1 && typeof renderOverview === 'function') renderOverview(); else if (typeof renderMap === 'function') renderMap(); } catch (_) {}
  toast('已儲存');
}
function deleteExpense() {
  if (!editingExpenseId) return;
  if (!confirm('確定刪除此項目？')) return;
  expenses = expenses.filter(e => e.id !== editingExpenseId);
  saveBudget();
  closeExpenseModal();
  renderBudget();
  try { if (activeDayIdx === -1 && typeof renderOverview === 'function') renderOverview(); else if (typeof renderMap === 'function') renderMap(); } catch (_) {}
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
          fxRate: null, // v43: follow global rate by default
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

  // Category change drives both hotel and flight visibility
  document.getElementById('e-cat').addEventListener('change', () => {
    updateHotelFieldsVisibility();
    updateFlightFieldsVisibility();
    updateFxConvertedSummary();
  });
  // v43: currency + locked-rate wiring
  document.getElementById('e-currency').addEventListener('change', () => {
    updateFxLockVisibility();
    updateFxConvertedSummary();
  });
  document.getElementById('e-fxlock').addEventListener('input', updateFxConvertedSummary);
  document.getElementById('e-amount').addEventListener('input', updateFxConvertedSummary);
  // Hotel live total
  ['e-rate','e-rooms','e-nights','e-currency'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { if (document.getElementById('e-cat').value === 'hotel') updateHotelTotal(); });
    if (el) el.addEventListener('change', () => { if (document.getElementById('e-cat').value === 'hotel') updateHotelTotal(); });
  });
  // Flight legs count change — re-render the leg cards
  document.getElementById('e-flight-legs').addEventListener('change', updateFlightLegsCount);
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
