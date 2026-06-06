// =============================================================
// JSONBin.io cloud sync for cross-device itinerary + budget.
// =============================================================
// Bin record shape:
//   {
//     state:       <whole itinerary state>,    // see app.js: state = { days: [...] }
//     expenses:    <expenses array>,           // see budget logic
//     settings:    <budget settings>,
//     updated_at:  <ISO timestamp>,
//     device_id:   <client device id>,
//     device_name: <human-readable label>
//   }
//
// Strategy: Last-Write-Wins with "warn before clobber".
//   - On startup we pullCloud() and compare cloud.updated_at to our
//     locally-stored last_synced_at. If cloud is strictly newer, we offer
//     to download.
//   - On any local mutation we schedule a debounced pushCloud() (3s).
//   - When pushing we re-fetch first and bail out (asking the user) if
//     cloud has been touched by another device since we last synced.
// =============================================================

(function () {
  const PUSH_DEBOUNCE_MS = 3000;

  // In-memory session state. The preview/static-host sandbox forbids
  // localStorage/sessionStorage/indexedDB, so device identity and sync
  // bookkeeping live for the lifetime of the page only (see CLAUDE.md §13).
  // Cloud sync itself still works: the JSONBin record is the source of truth.
  let deviceId = null;
  let deviceName = null;
  let syncMeta = {};

  function getDeviceId() {
    if (!deviceId) {
      deviceId = 'd_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    }
    return deviceId;
  }

  function getDeviceName() {
    if (deviceName) return deviceName;
    const ua = navigator.userAgent;
    if (/iPhone/i.test(ua)) deviceName = 'iPhone';
    else if (/iPad/i.test(ua)) deviceName = 'iPad';
    else if (/Android/i.test(ua)) deviceName = 'Android';
    else if (/Mac/i.test(ua)) deviceName = 'Mac';
    else if (/Windows/i.test(ua)) deviceName = 'Windows';
    else deviceName = 'Browser';
    return deviceName;
  }

  function setDeviceName(name) {
    deviceName = name;
  }

  function loadMeta() {
    return syncMeta;
  }
  function saveMeta(m) {
    syncMeta = m || {};
  }

  function isConfigured() {
    return !!(window.JSONBIN_BIN_ID && window.JSONBIN_ACCESS_KEY);
  }

  function endpoint() {
    return `https://api.jsonbin.io/v3/b/${window.JSONBIN_BIN_ID}`;
  }
  function headers(extra) {
    return Object.assign({
      'X-Access-Key': window.JSONBIN_ACCESS_KEY,
      'X-Bin-Meta': 'false', // strip metadata wrapper from responses
      'Content-Type': 'application/json'
    }, extra || {});
  }

  // Status callback registry — UI subscribes for live indicator updates.
  const statusListeners = new Set();
  let currentStatus = { state: 'idle', message: '' };
  function setStatus(state, message) {
    currentStatus = { state, message: message || '' };
    statusListeners.forEach(fn => { try { fn(currentStatus); } catch (_) {} });
  }

  // ---- Network primitives ----
  async function fetchCloud() {
    if (!isConfigured()) throw new Error('not_configured');
    const res = await fetch(endpoint() + '/latest', { headers: headers(), cache: 'no-store' });
    if (res.status === 404) return null; // empty bin
    if (!res.ok) throw new Error('http_' + res.status);
    const j = await res.json();
    // With X-Bin-Meta: false the body IS the record.
    return j && typeof j === 'object' ? j : null;
  }

  async function putCloud(record) {
    if (!isConfigured()) throw new Error('not_configured');
    const res = await fetch(endpoint(), {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(record)
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('http_' + res.status + ': ' + txt.slice(0, 200));
    }
    return await res.json();
  }

  // ---- Snapshot helpers (ask app to provide / accept current data) ----
  function snapshotLocal() {
    return {
      state:       window.app && typeof window.app.getState === 'function' ? window.app.getState() : null,
      expenses:    window.app && typeof window.app.getExpenses === 'function' ? window.app.getExpenses() : null,
      settings:    window.app && typeof window.app.getBudgetSettings === 'function' ? window.app.getBudgetSettings() : null
    };
  }

  function applyRemote(record) {
    if (!record) return;
    if (record.state    && window.app?.setState)          window.app.setState(record.state);
    if (record.expenses && window.app?.setExpenses)       window.app.setExpenses(record.expenses);
    if (record.settings && window.app?.setBudgetSettings) window.app.setBudgetSettings(record.settings);
  }

  // ---- Public actions ----
  async function pullCloud({ force = false, silent = false } = {}) {
    if (!isConfigured()) { if (!silent) setStatus('disabled', '未設定同步'); return null; }
    setStatus('syncing', '從雲端拉取…');
    try {
      const remote = await fetchCloud();
      if (!remote || !remote.updated_at) {
        setStatus('idle', '雲端無資料');
        return null;
      }
      const meta = loadMeta();
      const localLastSync = meta.last_synced_at || 0;
      const remoteTs = new Date(remote.updated_at).getTime();
      if (!force && remoteTs <= localLastSync) {
        setStatus('synced', '已是最新');
        return null;
      }
      // Cloud is newer — confirm before overwriting unless force=true
      const proceed = force || confirm(
        `雲端有更新版本：\n` +
        `${new Date(remote.updated_at).toLocaleString()}（${remote.device_name || '其他裝置'}）\n\n` +
        `下載並覆蓋本地？`
      );
      if (!proceed) {
        setStatus('idle', '已忽略雲端版本');
        return null;
      }
      applyRemote(remote);
      saveMeta({ ...meta, last_synced_at: remoteTs, last_remote_ts: remoteTs });
      setStatus('synced', '已同步：' + new Date(remoteTs).toLocaleTimeString());
      return remote;
    } catch (e) {
      setStatus('error', '拉取失敗：' + e.message);
      throw e;
    }
  }

  async function pushCloud({ force = false } = {}) {
    if (!isConfigured()) { setStatus('disabled', '未設定同步'); return null; }
    setStatus('syncing', '上傳中…');
    try {
      // Conflict check: re-fetch remote first
      const remote = await fetchCloud();
      const meta = loadMeta();
      const localLastSync = meta.last_synced_at || 0;
      if (!force && remote && remote.updated_at) {
        const remoteTs = new Date(remote.updated_at).getTime();
        if (remoteTs > localLastSync && remote.device_id !== getDeviceId()) {
          // Someone else (or another device) updated cloud after our last sync
          const proceed = confirm(
            `衝突：雲端版本（${new Date(remote.updated_at).toLocaleString()} - ${remote.device_name || '其他裝置'}）` +
            `較你本地嘅最新同步時間更新。\n\n撳「確定」覆蓋雲端，撳「取消」保留雲端版本（建議先「拉取」合併）。`
          );
          if (!proceed) {
            setStatus('conflict', '雲端較新');
            return null;
          }
        }
      }
      const snap = snapshotLocal();
      const now = new Date();
      const record = {
        state:       snap.state,
        expenses:    snap.expenses,
        settings:    snap.settings,
        updated_at:  now.toISOString(),
        device_id:   getDeviceId(),
        device_name: getDeviceName()
      };
      await putCloud(record);
      const ts = now.getTime();
      saveMeta({ ...meta, last_synced_at: ts, last_remote_ts: ts });
      setStatus('synced', '已同步：' + now.toLocaleTimeString());
      return record;
    } catch (e) {
      setStatus('error', '上傳失敗：' + e.message);
      throw e;
    }
  }

  // ---- Debounced trigger from local mutations ----
  let debounceTimer = null;
  function scheduleSync() {
    if (!isConfigured()) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    setStatus('pending', '即將上傳…');
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      pushCloud().catch(() => {}); // status already set
    }, PUSH_DEBOUNCE_MS);
  }

  // Public API on window.cloudSync
  window.cloudSync = {
    isConfigured,
    pullCloud,
    pushCloud,
    scheduleSync,
    getDeviceId,
    getDeviceName,
    setDeviceName,
    onStatus(fn) { statusListeners.add(fn); fn(currentStatus); return () => statusListeners.delete(fn); },
    getStatus() { return currentStatus; }
  };
})();
