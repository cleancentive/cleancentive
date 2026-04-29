/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;
declare const __APP_BUILD_TIME__: number;

interface CleancentiveConfig {
  umamiScriptUrl?: string;
  umamiWebsiteId?: string;
  umamiShareUrl?: string;
  wikiUrl?: string;
}

interface Window {
  __CLEANCENTIVE_CONFIG__?: CleancentiveConfig;
  umami?: {
    track: (name: string, data?: Record<string, string | number>) => void;
    identify: (id: string, data?: Record<string, string | number>) => void;
  };
}
