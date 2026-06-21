import i18n, { type Resource, type ResourceLanguage } from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from '@cleancentive/shared/locale'

// Resources are bundled statically (no HTTP backend) so the PWA works offline
// and there is no flash of untranslated content. Drop a JSON file at
// `locales/<lng>/<namespace>.json` and it is picked up automatically.
const modules = import.meta.glob('./locales/*/*.json', { eager: true })

const resources: Resource = {}
for (const [path, mod] of Object.entries(modules)) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/)
  if (!match) continue
  const [, lng, ns] = match
  const lngResources = (resources[lng] ??= {} as ResourceLanguage)
  lngResources[ns] = ((mod as { default?: unknown }).default ?? mod) as ResourceLanguage
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: [...SUPPORTED_LOCALES],
    fallbackLng: DEFAULT_LOCALE,
    defaultNS: 'common',
    // Normalize regional tags from the browser: `de-CH` → `de`.
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      // Precedence: explicit ?locale= override (deep links, test scripts) →
      // the guest's cached choice → the browser's Accept-Language.
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'locale',
      lookupLocalStorage: 'cc-locale',
      caches: ['localStorage'],
    },
  })

// Keep <html lang> in sync for accessibility and correct CSS :lang() behavior.
function syncHtmlLang(lng: string) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng
  }
}
syncHtmlLang(i18n.resolvedLanguage || i18n.language || DEFAULT_LOCALE)
i18n.on('languageChanged', syncHtmlLang)

export default i18n
