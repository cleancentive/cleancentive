const UMAMI_SCRIPT_URL = (import.meta.env.VITE_UMAMI_SCRIPT_URL || (import.meta.env.DEV ? 'http://localhost:3001/data.js' : undefined)) as string | undefined;
const UMAMI_WEBSITE_ID = import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined;

/** Inject the Umami tracking script if configured via env vars. */
export function initAnalytics() {
  if (!UMAMI_SCRIPT_URL || !UMAMI_WEBSITE_ID) return;

  const script = document.createElement('script');
  script.defer = true;
  script.src = UMAMI_SCRIPT_URL;
  script.dataset.websiteId = UMAMI_WEBSITE_ID;
  document.head.appendChild(script);
}

/** Track a named event with optional properties. No-op if Umami is not loaded. */
export function trackEvent(name: string, data?: Record<string, string | number>) {
  if (window.umami) {
    window.umami.track(name, data);
  }
}
