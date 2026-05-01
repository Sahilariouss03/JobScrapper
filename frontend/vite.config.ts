import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react' // (or vue, svelte, etc.)

export default defineConfig({
  plugins: [react()],
  build: {
    // Increase the limit to 1000 kB (1 MB) or whatever size clears the warning
    chunkSizeWarningLimit: 1000,
  }
})