/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface Window {
  umami?: {
    track: (name: string, data?: Record<string, string | number>) => void;
  };
}
