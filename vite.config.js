import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        headers: {
            // Required for SharedArrayBuffer (used by some WASM builds)
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
    optimizeDeps: {
        exclude: ['blinkenlib'],
    },
    build: {
        target: 'esnext',
        outDir: 'dist',
    },
});