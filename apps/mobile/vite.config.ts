import { defineConfig } from 'vite';

// Bundles the plain TS + HTML/CSS native-side screens into www/ (Capacitor's
// webDir). `publicDir` copies assets/fonts and assets/icons straight through
// so styles.css's relative `url('fonts/...')` and the manifest icon paths
// resolve unchanged in the built output.
export default defineConfig({
  root: 'src',
  base: '',
  publicDir: '../assets',
  build: {
    outDir: '../www',
    emptyOutDir: true,
    target: 'es2022',
  },
});
