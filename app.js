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
  try { safeStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.warn('storage write failed', e); }
}

// --- Map setup ---
let baseLayer;
const BASE_LAYERS = {
  map: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    options: {
      subdomains: 'abcd', maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · © <a href="https://carto.com/attributions">CARTO</a>'
    }
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 19,
      attribution: '© Esri · Earthstar Geographics'
    }
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: {
      subdomains: 'abc', maxZoom: 17,
      attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> · © OSM'
    }
  }
};

function setBaseLayer(name) {
  if (baseLayer) map.removeLayer(baseLayer);
  const cfg = BASE_LAYERS[name] || BASE_LAYERS.map;
  baseLayer = L.tileLayer(cfg.url, cfg.options).addTo(map);
  if (layerGroup) layerGroup.eachLayer(l => l.bringToFront && l.bringToFront());
  document.querySelectorAll('#layer-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.layer === name);
  });
}

function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView([26.5, 100.5], 7);

  setBaseLayer('map');

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

  layerGroup = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    if (pickingMode) {
      const { lat, lng } = e.latlng;
      pickingMode.onPicked(lat, lng);
      exitPickingMode();
    }
  });
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
    points.push([startHotel.lat, startHotel.lng]);
  }

  // Spots in order
  day.spots.forEach((spot, i) => {
    const m = createMarker(spot, { color: day.color, label: String(i + 1) });
    m.bindPopup(buildPopup(spot, { kind: 'spot', dayIdx: activeDayIdx, spotIdx: i }));
    m.on('click', () => m.openPopup());
    layerGroup.addLayer(m);
    points.push([spot.lat, spot.lng]);
  });

  // Tonight's hotel as the end of the route
  if (day.hotel) {
    const m = createMarker(day.hotel, { isHotel: true, color: day.color, label: '🏨' });
    m.bindPopup(buildPopup(day.hotel, { kind: 'hotel', dayIdx: activeDayIdx }));
    m.on('click', () => m.openPopup());
    layerGroup.addLayer(m);
    points.push([day.hotel.lat, day.hotel.lng]);
  }

  // Also display previous hotel as a faded marker (context)
  if (startHotel && (!day.hotel || startHotel.lat !== day.hotel.lat || startHotel.lng !== day.hotel.lng)) {
    const m = createMarker(startHotel, { isHotel: true, color: '#9aa0a6', label: '🏨', faded: true });
    m.bindPopup(`<div class="popup-title">${escapeHTML(startHotel.name)}</div><div class="popup-meta">前一晚住宿（Day ${activeDayIdx}）</div>`);
    m.on('click', () => m.openPopup());
    layerGroup.addLayer(m);
  }

  // Route line (dashed)
  if (points.length > 1) {
    routeLine = L.polyline(points, {
      color: day.color || '#1d3557',
      weight: 3,
      opacity: 0.75,
      dashArray: '6, 8',
      lineCap: 'round'
    });
    layerGroup.addLayer(routeLine);
  }

  // Fit bounds
  if (points.length) {
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 13 });
  }
}

// --- Overview: all days, all locations ---
function renderOverview() {
  const allPoints = [];
  const seenHotelKeys = new Set();

  state.days.forEach((day, dayIdx) => {
    // Build per-day route: previous hotel -> spots -> this hotel
    const routePts = [];
    const prev = dayIdx > 0 ? state.days[dayIdx - 1] : null;
    if (prev && prev.hotel) routePts.push([prev.hotel.lat, prev.hotel.lng]);
    day.spots.forEach(s => routePts.push([s.lat, s.lng]));
    if (day.hotel) routePts.push([day.hotel.lat, day.hotel.lng]);

    // Day route line (dashed, day color)
    if (routePts.length > 1) {
      const line = L.polyline(routePts, {
        color: day.color || '#1d3557',
        weight: 3,
        opacity: 0.7,
        dashArray: '6, 8',
        lineCap: 'round'
      });
      layerGroup.addLayer(line);
    }

    // Spot markers
    day.spots.forEach((spot, i) => {
      const m = createMarker(spot, { color: day.color, label: String(i + 1), small: true });
      m.bindPopup(buildPopup(spot, { kind: 'spot', dayIdx, spotIdx: i }));
      m.on('click', () => m.openPopup());
      layerGroup.addLayer(m);
      allPoints.push([spot.lat, spot.lng]);
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
        allPoints.push([day.hotel.lat, day.hotel.lng]);
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
  return L.marker([loc.lat, loc.lng], { icon, draggable: false });
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

// --- Drawer / sidebar list ---
function renderDrawer() {
  const body = document.getElementById('drawer-body');
  body.innerHTML = '';
  state.days.forEach((d, dayIdx) => {
    const card = document.createElement('div');
    card.className = 'day-card';
    card.id = `day-card-${dayIdx}`;
    card.innerHTML = `
      <div class="day-card-head">
        <div class="day-num" style="background:${d.color}">${d.day}</div>
        <div class="day-meta">
          <div class="day-meta-title">${escapeHTML(d.city)} · ${escapeHTML(d.date)}</div>
          <div class="day-meta-sub">${d.spots.length} 個景點 · 入住 ${escapeHTML(d.hotel?.name || '—')}</div>
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
        map.flyTo([loc.lat, loc.lng], 14, { duration: 0.6 });
        // open popup
        layerGroup.eachLayer(layer => {
          if (layer.getLatLng && Math.abs(layer.getLatLng().lat - loc.lat) < 1e-6 && Math.abs(layer.getLatLng().lng - loc.lng) < 1e-6) {
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
      el.textContent = '找不到相關說明。可點「編輯」手動輸入。';
    }
  }
};

// --- Wikipedia summary (zh + en fallback) ---
async function fetchWikipediaSummary(name) {
  const tryFetch = async (lang) => {
    try {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}?redirect=true`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const j = await r.json();
      if (j.extract && j.extract.length > 20) return j.extract;
      return null;
    } catch (_) { return null; }
  };
  return (await tryFetch('zh')) || (await tryFetch('en'));
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
  // Bias around Yunnan center for relevance
  return new Promise(resolve => {
    _autocompleteService.getPlacePredictions({
      input: query,
      language: 'zh-HK',
      region: 'cn',
      locationBias: {
        center: { lat: 26.5, lng: 100.5 },
        radius: 400000  // 400 km around Yunnan
      }
    }, (preds, status) => {
      if (status !== 'OK' || !preds) return resolve([]);
      // Map to a normalised structure with place_id; we'll resolve coords on click.
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
    _placesService.getDetails({
      placeId,
      fields: ['geometry', 'name', 'formatted_address']
    }, (place, status) => {
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
  const url = `https://nominatim.openstreetmap.org/search?` + new URLSearchParams({
    q: query, format: 'json', limit: '8', 'accept-language': 'zh-Hant,zh,en',
    addressdetails: '1'
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
  try { safeStorage.setItem(BUDGET_KEY, JSON.stringify(expenses)); } catch (_) {}
}
function saveSettings() {
  try { safeStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
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

// auto-init when DOM ready (works alongside the main DOMContentLoaded handler above)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireBudget);
} else {
  wireBudget();
}
