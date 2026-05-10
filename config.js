// Google Maps API key.
// IMPORTANT: This key MUST be restricted in Google Cloud Console:
//   - Application restrictions: HTTP referrers (https://*.perplexity.ai/*)
//   - API restrictions: Maps JavaScript API, Places API, Geocoding API
//   - Set daily quota limits to prevent abuse.
window.GOOGLE_MAPS_API_KEY = 'AIzaSyBe_I_b5UlaTCvbFpBgR-t-zCov1b-NPNM';

// --- JSONBin.io cloud sync ---
// Steps to enable cross-device sync (one-time):
//   1. Create a free account at https://jsonbin.io
//   2. Create a new BIN with initial content {} (private)
//   3. Copy the BIN ID (24-char hex from the URL, e.g. 6543abcd...)
//   4. Account → API Keys → either copy the X-MASTER-KEY,
//      OR (recommended) create an Access Key with read+update permissions
//      restricted to this single bin.
//   5. Paste them below. Leave both empty to disable sync entirely.
//
// SECURITY NOTE: this key is bundled into the deployed JS, so anyone who
// finds the URL (https://timchan1005.github.io/yunnan-trip/) can read AND
// overwrite this single bin. Use an Access Key (not Master Key) and restrict
// it to read+update on this bin only — they cannot touch your other bins.
window.JSONBIN_BIN_ID = '';
window.JSONBIN_ACCESS_KEY = '';
