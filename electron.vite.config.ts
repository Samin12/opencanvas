import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'electron-vite'

const rendererPort = Number.parseInt(process.env.OPEN_CANVAS_RENDERER_PORT ?? '', 10)
const rendererServer =
  Number.isFinite(rendererPort) && rendererPort > 0
    ? {
        port: rendererPort,
        strictPort: true
      }
    : undefined

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        external: ['node-pty'],
        output: {
          format: 'cjs'
        }
      }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        output: {
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss()],
    server: rendererServer,
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      outDir: 'out/renderer'
    }
  }
})
