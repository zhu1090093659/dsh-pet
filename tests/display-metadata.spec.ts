/**
 * Plugin page display metadata gate. The host renders each plugin row's title
 * and grey description from <package>/locale/<lang>.json (meta.title and
 * meta.description): it resolves locale/en.json first, then enumerates every
 * *.json in that directory and resolves each one through this package's own
 * exports map. A file without its "./locale/<lang>.json" export key, a key
 * without its file, or a locale directory npm drops because "files" does not
 * list it makes the whole metadata read fail, and the plugin page silently
 * falls back to the npm package name and the English package description.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  icon?: unknown
  files?: unknown
  exports?: Record<string, unknown>
}
const REQUIRED_LANGUAGES = ['en', 'zh']
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu
const MAX_ZH_DESCRIPTION_HAN = 20
const ICON_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp']

function localeFiles(): string[] {
  const dir = join(ROOT, 'locale')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
}

function metaOf(language: string): Record<string, string> {
  const doc = JSON.parse(readFileSync(join(ROOT, 'locale', language + '.json'), 'utf8')) as {
    meta?: Record<string, string>
  }
  return doc.meta ?? {}
}

describe('plugin page display metadata', () => {
  it('ships the languages the plugin page renders', () => {
    for (const language of REQUIRED_LANGUAGES) {
      expect(existsSync(join(ROOT, 'locale', language + '.json')), language).toBe(true)
    }
  })

  it('exports every locale file on disk and ships no key without a file', () => {
    const exported = Object.keys(MANIFEST.exports ?? {})
      .filter((key) => key.startsWith('./locale/'))
      .map((key) => key.slice('./locale/'.length))
      .sort()
    expect(exported).toEqual(localeFiles())
  })

  it('carries only a non-empty title and description per language', () => {
    for (const file of localeFiles()) {
      const doc = JSON.parse(readFileSync(join(ROOT, 'locale', file), 'utf8')) as Record<string, unknown>
      expect(Object.keys(doc), file).toEqual(['meta'])
      const meta = doc.meta as Record<string, unknown>
      for (const field of ['title', 'description']) {
        expect(typeof meta[field], file + ' meta.' + field).toBe('string')
        expect((meta[field] as string).trim(), file + ' meta.' + field).not.toBe('')
      }
    }
  })

  it('writes Chinese copy that differs from English and stays short', () => {
    const en = metaOf('en')
    const zh = metaOf('zh')
    expect(zh.title).not.toBe(en.title)
    expect(zh.description).not.toBe(en.description)
    const han = zh.description?.match(HAN) ?? []
    expect(han.length).toBeGreaterThan(0)
    expect(han.length).toBeLessThanOrEqual(MAX_ZH_DESCRIPTION_HAN)
  })

  it('publishes the locale directory and the card icon', () => {
    expect(Array.isArray(MANIFEST.files)).toBe(true)
    const files = MANIFEST.files as string[]
    expect(files).toContain('locale')
    const icon = MANIFEST.icon
    expect(typeof icon).toBe('string')
    expect(isAbsolute(icon as string)).toBe(false)
    const iconPath = resolve(ROOT, icon as string)
    const inside = relative(ROOT, iconPath).replaceAll('\\', '/')
    expect(inside.length).toBeGreaterThan(0)
    expect(inside.startsWith('..')).toBe(false)
    expect(statSync(iconPath).isFile()).toBe(true)
    expect(ICON_EXTENSIONS).toContain(extname(iconPath).toLowerCase())
    expect(files).toContain(inside)
  })
})
