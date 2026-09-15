import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
  },
  plugins: [
    react(),
    tailwindcss(),
    // Electron 메인 프로세스 빌드 설정
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // 네이티브 바이너리가 필요한 모듈만 external로 유지
              // 순수 JS 모듈(telegram, googleapis 등)은 번들에 포함시켜야
              // exe 패키징 시 node_modules 하위 의존성 누락 문제를 방지할 수 있음
              external: [
                'better-sqlite3',
                'puppeteer-extra-plugin-stealth',
                'playwright-extra',
                'playwright',
                'googleapis',
                'node-telegram-bot-api'
              ],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          // preload 스크립트가 빌드되면 Electron 메인 프로세스를 리로드
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
    ]),
    // 렌더러 프로세스에서 Node.js API 사용 가능하게 설정
    electronRenderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
