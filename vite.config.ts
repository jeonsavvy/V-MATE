import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    modulePreload: {
      resolveDependencies(_filename, deps, context) {
        if (context.hostType === 'html') {
          return deps.filter(
            (dependency) =>
              !dependency.includes('vendor-supabase') &&
              !dependency.includes('historySupabaseStore')
          )
        }

        return deps
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return
          }

          if (
            id.includes('@radix-ui') ||
            id.includes('react-hook-form') ||
            id.includes('sonner') ||
            id.includes('clsx') ||
            id.includes('tailwind-merge')
          ) {
            return 'vendor-ui'
          }

          if (id.includes('lucide-react')) {
            return 'vendor-icons'
          }

          if (id.includes('@supabase/supabase-js')) {
            return 'vendor-supabase'
          }

          if (id.includes('/react/') || id.includes('react-dom')) {
            return 'vendor-react'
          }
        },
      },
    },
  },
  publicDir: 'assets',
})
