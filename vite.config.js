import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appTarget = env.VITE_APP_API_BASE_URL || 'http://localhost:3001'
  const ttsTarget = env.VITE_TTS_API_BASE_URL || 'http://127.0.0.1:9880'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: appTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/tts-api': {
          target: ttsTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/tts-api/, ''),
        },
      },
    },
  }
})
