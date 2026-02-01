# TapLock (Base)

A one-tap timing game built with Phaser 3.

## Run locally (recommended)
Use a local server (don't open index.html directly via file://).

### Option A: VS Code Live Server
1. Install the "Live Server" extension
2. Right click `index.html` -> "Open with Live Server"

### Option B: Python simple server
```bash
cd taplock
python -m http.server 5500
```
Open: http://localhost:5500

## Test on iPhone (best Windows workflow)
1. Ensure phone + PC are on the same Wi-Fi.
2. Find your PC IPv4 address (Windows):
   - Open Command Prompt -> `ipconfig`
3. If your server is on port 5500, open on iPhone Safari:
   - http://YOUR_IPV4:5500

## Install on iPhone
1. Open the game in Safari.
2. Tap the Share button.
3. Choose "Add to Home Screen".

## Offline support
- The first load must be online so assets can be cached.
- After that, the game can launch offline from the cache.

## Next steps (we'll add iteratively)
- Continue (rewarded ad placeholder) + interstitial pacing
- Better juice (hit sparks, miss burst)
