import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/** Native addons cannot be bundled; electron-vite's ssr.noExternal:true fights externalizeDepsPlugin. */
const NATIVE_MODULES = ['better-sqlite3', 'bindings', 'file-uri-to-path'] as const

function externalizeNativeModules(): Plugin {
  return {
    name: 'relay:externalize-native-modules',
    configResolved(config) {
      // Vite merge keeps ssr.noExternal true if any plugin set it; patch after merge.
      config.ssr.noExternal = false
      const existing = config.ssr.external
      config.ssr.external = [
        ...NATIVE_MODULES,
        ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
      ]
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), externalizeNativeModules()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          webview: resolve(__dirname, 'src/preload/webview.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer')
      }
    },
    plugins: [react()]
  }
})
