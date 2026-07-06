import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const googleMtProxy = {}
for (let i = 0; i <= 3; i++) {
  const s = String(i)
  googleMtProxy[`/gproxy/mt${s}`] = {
    target: `https://mt${s}.google.com`,
    changeOrigin: true,
    rewrite: (path) => path.replace(`/gproxy/mt${s}`, '')
  }
}

export default defineConfig({
  plugins: [vue()],
  base: '/ge-assistant/',
  server: {
    port: 3000,
    open: true,
    proxy: {
      ...googleMtProxy,
      '/gproxy/kh': {
        target: 'https://khmdb.google.com',
        changeOrigin: true,
        rewrite: (path) => path.replace('/gproxy/kh', '/kh')
      },
      '/gproxy/dbroot': {
        target: 'https://khmdb.google.com',
        changeOrigin: true,
        rewrite: () => '/dbRoot.v5?&hl=en&gl=us&output=proto'
      },
      '/gproxy/flatfile': {
        target: 'https://khmdb.google.com',
        changeOrigin: true,
        rewrite: (path) => path.replace('/gproxy/flatfile', '/flatfile')
      }
    }
  }
})
