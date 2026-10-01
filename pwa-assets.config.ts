import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Generates favicon.ico, apple-touch-icon, PWA and maskable icons from the master logo.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0.25, resizeOptions: { background: '#0f766e' } },
    apple: { ...minimal2023Preset.apple, padding: 0.2, resizeOptions: { background: '#0f766e' } },
  },
  images: ['public/logo-mark.svg'],
});
