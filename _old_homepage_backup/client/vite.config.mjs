import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
    root: '.',
    plugins: [
        react(),
        tailwindcss(),
    ],
    server: {
        host: true,
        port: 4000,
        proxy: {
            '/api': {
                target: 'http://localhost:5000',
                changeOrigin: true,
            },
            '/static': {
                target: 'http://localhost:5000',
                changeOrigin: true,
            }
        }
    },
    build: {
        outDir: 'dist', // This will be overridden by CLI flag anyway, but let's keep it safe
        emptyOutDir: true,
        minify: true,
    }
})
