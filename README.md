# Estra7ah viewer

Browse and play content from the Estra7ah media server (http://10.10.10.10).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Notes

- The laptop/phone must be on the **same network** as the server (10.10.10.10).
- All requests go through the Vite proxy (`/api` -> http://10.10.10.10),
  which avoids CORS and follows the image redirect to port 8090.
- Change the server IP in `vite.config.js` (the `target` line).

## How it works

- Sections load from `/api/sections`.
- "main" sections open sub-sections via `/api/sections/0/100/{id}`.
- Content sections load items via `/api/getItems/0/300/{id}`.
- Movies play from `/api/getPlayData/{id}` -> `/api/stream/{src}`.
- Series: item -> `/api/getSeries/{id}` (seasons) -> episodes -> play.
- Posters: `/api/ItemImage/{id}`.
- Each video has an "Open in VLC" button (Android intent).
