/**
 * Status-decoration manifest tests (pet-center M5, #567): fail-closed
 * structure, warn-and-drop content, duration normalization and the
 * PNG/WebP entry discipline.
 */
import { describe, expect, it } from 'vitest'
import { parseDecorationManifest, safeDecorationEntry } from './decoration.ts'

function parse(raw: unknown) {
  return parseDecorationManifest(raw, 'test/decoration.json')
}

function valid(): Record<string, unknown> {
  return {
    decorationManifestVersion: 1,
    id: 'whale',
    displayName: '喷水鲸鱼',
    license: 'MIT',
    entry: 'whale-frames.png',
    cell: { width: 64, height: 48 },
    columns: 4,
    frameMs: 140,
    loop: true,
    phases: {
      idle: 'hide',
      waiting: { from: 0, to: 1 },
      thinking: { from: 0, to: 3 },
    },
  }
}

describe('parseDecorationManifest structure', () => {
  it('accepts a valid descriptor with duration and display-name defaults', () => {
    const verdict = parse(valid())
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.manifest.durations).toEqual([140, 140, 140, 140])
    expect(verdict.manifest.loop).toBe(true)
    expect(verdict.manifest.phases.thinking).toEqual({ from: 0, to: 3 })
    expect(verdict.manifest.phases.idle).toBe('hide')
  })

  it('defaults displayName to the id and frameMs to 120', () => {
    const manifest = { ...valid() }
    delete manifest.displayName
    delete manifest.frameMs
    const verdict = parse(manifest)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.manifest.displayName).toBe('whale')
    expect(verdict.manifest.durations).toEqual([120, 120, 120, 120])
  })

  it('rejects non-object roots, wrong versions and unknown top-level fields', () => {
    expect(parse(['x']).ok).toBe(false)
    const wrongVersion = { ...valid(), decorationManifestVersion: 2 }
    const verdict = parse(wrongVersion)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.diagnostics.some(d => d.message.includes('decorationManifestVersion'))).toBe(true)
    const unknown = { ...valid(), mystery: true }
    expect(parse(unknown).ok).toBe(false)
  })

  it('rejects unsafe or non-image entries', () => {
    for (const entry of ['../etc/passwd', '/abs.png', 'a.svg', 'a.css', 'x\\y.png']) {
      const verdict = parse({ ...valid(), entry })
      expect(verdict.ok).toBe(false)
    }
  })

  it('rejects out-of-range geometry and missing license/id', () => {
    expect(parse({ ...valid(), cell: { width: 999, height: 48 } }).ok).toBe(false)
    expect(parse({ ...valid(), columns: 99 }).ok).toBe(false)
    expect(parse({ ...valid(), license: '' }).ok).toBe(false)
    expect(parse({ ...valid(), id: 'Bad Id' }).ok).toBe(false)
  })
})

describe('parseDecorationManifest content (warn-and-drop)', () => {
  it('drops unknown phase keys and out-of-range segments with warnings', () => {
    const verdict = parse({
      ...valid(),
      phases: {
        ...(valid().phases as Record<string, unknown>),
        bogus: { from: 0, to: 1 },
        waiting: { from: 2, to: 9 },
        review: { from: 3, to: 1 },
      },
    })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.manifest.phases.done).toBeUndefined()
    expect(verdict.manifest.phases.waiting).toBeUndefined()
    expect(verdict.manifest.phases.review).toBeUndefined()
    expect(verdict.diagnostics.some(d => d.level === 'warning' && d.message.includes('ignored'))).toBe(true)
  })

  it('warns when no phase shows the ornament', () => {
    const verdict = parse({ ...valid(), phases: { idle: 'hide' } })
    expect(verdict.ok).toBe(true)
    expect(verdict.diagnostics.some(d => d.level === 'warning' && d.message.includes('stays hidden'))).toBe(true)
  })

  it('falls back to the constant frameMs when durations has the wrong length', () => {
    const verdict = parse({ ...valid(), durations: [100] })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.manifest.durations).toEqual([140, 140, 140, 140])
    expect(verdict.diagnostics.some(d => d.level === 'warning' && d.message.includes('durations'))).toBe(true)
  })

  it('keeps a well-sized durations array', () => {
    const verdict = parse({ ...valid(), durations: [120, 130, 140, 150] })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.manifest.durations).toEqual([120, 130, 140, 150])
  })
})

describe('safeDecorationEntry', () => {
  it('accepts safe relative PNG/WebP paths and rejects everything else', () => {
    expect(safeDecorationEntry('frames.webp')).toBe('frames.webp')
    expect(safeDecorationEntry('img/FRAMES.PNG')).toBe('img/FRAMES.PNG')
    expect(safeDecorationEntry('a/b.png')).toBe('a/b.png')
    expect(safeDecorationEntry('')).toBeUndefined()
    expect(safeDecorationEntry('a/../b.png')).toBeUndefined()
    expect(safeDecorationEntry('/tmp/x.png')).toBeUndefined()
    expect(safeDecorationEntry('x.svg')).toBeUndefined()
    expect(safeDecorationEntry('x')).toBeUndefined()
  })
})