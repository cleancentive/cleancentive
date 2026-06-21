import { describe, test, expect } from 'vitest'
import { SUPPORTED_LOCALES } from '@cleancentive/shared/locale'

// Every namespace must define the same key set in every locale, so no string
// silently falls back to English because a translation key was forgotten.
const modules = import.meta.glob('./locales/*/*.json', { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  )
}

// Build { namespace: { locale: Set<keys> } }
const byNs: Record<string, Record<string, Set<string>>> = {}
for (const [path, mod] of Object.entries(modules)) {
  const m = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/)
  if (!m) continue
  const [, lng, ns] = m
  ;(byNs[ns] ??= {})[lng] = new Set(flatten(mod.default))
}

describe('i18n resource completeness', () => {
  for (const [ns, locales] of Object.entries(byNs)) {
    const enKeys = locales.en
    test(`namespace "${ns}" has en`, () => {
      expect(enKeys, `namespace ${ns} is missing an en file`).toBeDefined()
    })

    for (const lng of SUPPORTED_LOCALES) {
      if (lng === 'en') continue
      test(`namespace "${ns}" — ${lng} matches en key set`, () => {
        const keys = locales[lng]
        expect(keys, `${lng}/${ns}.json missing`).toBeDefined()
        const missing = [...enKeys].filter((k) => !keys.has(k))
        const extra = [...keys].filter((k) => !enKeys.has(k))
        expect({ missing, extra }).toEqual({ missing: [], extra: [] })
      })
    }
  }
})
