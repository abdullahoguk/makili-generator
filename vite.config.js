import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // 5173 başka bir projede kullanılıyor; çakışmasın diye sabitlendi.
  // strictPort: port doluysa sessizce kaymak yerine hata ver.
  server: {
    port: 5174,
    strictPort: true,
    // Cloudflare Tunnel üzerinden gelen istekler yabancı bir Host başlığı
    // taşıyor; Vite bunları varsayılan olarak 400 ile reddediyor.
    allowedHosts: ['.abdullahog.uk']
  },
  preview: { port: 5174, strictPort: true },
  build: { outDir: 'dist' }
})
