import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client', 'scheduler'],
          'color-engine': [
            './src/engine/adjustmentTypes.ts',
            './src/engine/adjustmentMath.ts',
            './src/engine/colorLut.ts',
            './src/engine/gradientRamp.ts',
          ],
        },
      },
    },
  },
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost'] },
  preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost'] },
})
