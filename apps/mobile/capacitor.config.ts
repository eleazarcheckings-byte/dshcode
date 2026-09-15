/// <reference types="@capacitor/background-runner" />
import type { CapacitorConfig } from '@capacitor/cli';
import { buildBackgroundRunnerConfig } from './src/lib/backgroundSync.ts';

// Saturn AI companion shell (SPEC.md §8, M3). The app pairs with a host
// discovered at runtime (a LAN IP or a *.trycloudflare.com tunnel), so the
// host origin cannot be known at build time — `allowNavigation: ['*']` lets
// the WebView follow that paired url. This is a deliberate tradeoff, not an
// oversight: the app never navigates anywhere on its own, only to the exact
// `url` the user's own QR code names, and every request to it still carries
// the pinned-cert check (src/lib/certPin.ts) and the per-device bearer token
// from pairing. See apps/mobile/README.md "Security model" for the full
// writeup and the pinning code paths on each platform.
const config: CapacitorConfig = {
  appId: 'ai.saturnai.mobile',
  appName: 'Saturn AI',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    allowNavigation: ['*'],
  },
  ios: {
    contentInset: 'always',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 400,
      backgroundColor: '#0b0b12',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0b0b12',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_saturn_ring',
      iconColor: '#dda43a',
    },
    // SPEC.md §8 DELIVER: background poll of /saturn/remote/events -> local
    // notifications (Mars r1 finding #2). See apps/mobile/assets/background-runner.js
    // and src/lib/backgroundSync.ts, which is this block's single source of truth.
    BackgroundRunner: buildBackgroundRunnerConfig(),
  },
};

export default config;
