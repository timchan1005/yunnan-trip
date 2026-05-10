# 雲南 13 日互動行程地圖

2026/10/10–22 雲南旅程嘅互動地圖網站，包含：
- 13 日完整行程（昆明 → 大理 → 麗江 → 瀘沽湖 → 香格里拉 → 飛來寺）
- 多圖層底圖（OSM／衛星／地形）
- Google Places 地點搜尋
- 預算追蹤（多幣種、自動匯率轉換）
- PWA 離線支援

## 技術

- 純靜態 HTML / CSS / JavaScript
- Leaflet（地圖）+ Google Maps Places API（搜尋）+ Nominatim（fallback）
- LocalStorage 儲存
- Service Worker for PWA

## 部署

呢個 repo 經 GitHub Pages 自動部署。

### Google Maps API Key

`config.js` 內嘅 API key 需要喺 [Google Cloud Console](https://console.cloud.google.com/apis/credentials) 設定 HTTP referrer 限制：

- 加入 `https://<username>.github.io/*`
- API restrictions: Maps JavaScript API + Places API + Geocoding API

## 本地開發

```bash
python3 -m http.server 5000
# 開 http://localhost:5000
```
