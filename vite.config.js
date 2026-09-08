import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const target = 'http://10.10.10.10'
const p = (a) => Object.fromEntries(
  a.map((x) => [x, { target, changeOrigin: true, followRedirects: true }])
)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, port: 5173, proxy: p(['/api']) },
})
