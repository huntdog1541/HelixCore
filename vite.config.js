import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        headers: {
            // Required for SharedArrayBuffer (used by some WASM builds)
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
            // CORS headers for dev mode
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    },
    preview: {
        headers: {
            // Required for SharedArrayBuffer (used by some WASM builds)
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
    optimizeDeps: {
        exclude: ['ax-x86'],
    },
    build: {
        target: 'esnext',
        outDir: 'dist',
    },
});
