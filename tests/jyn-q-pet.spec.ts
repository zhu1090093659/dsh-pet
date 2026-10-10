/**
 * jyn-q (鲸鱼娘 Q版) pet manifest + on-disk frames guard: 8 frames2d tracks
 * (148 frames) — a breathing idle, the six activity-phase reactions
 * (waiting / thinking / tool / review / done / failed) and one tap reaction.
 * Every frame is generated procedurally from a single static illustration
 * with a foot-anchored affine transform, so the package stays small and is
 * pure content: no host or client code changes alongside it.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parsePetManifest } from '../src/manifest-v2.ts'
import { petPackageRoot } from '../src/registry.ts'
import { imageDimensions } from '../src/image-dimensions.ts'

const JYN_Q_DIR = join(petPackageRoot(import.meta.url), 'assets', 'jyn-q')

/** Frames shipped per track; the manifest omits explicit lists and the host lists the directory. */
const TRACK_FRAMES: Readonly<Record<string, number>> = {
  idle: 24, waiting: 20, thinking: 20, tool: 16, review: 18, done: 18, failed: 16, happy: 16,
}

/** One-shot reactions that must settle back into the idle loop. */
const ONE_SHOT = ['done', 'failed', 'happy'] as const

/** Activity phases every frames2d pet maps; unmapped phases fall back to idle. */
const PHASES = ['waiting', 'thinking', 'tool', 'review', 'done', 'failed'] as const

/** Webp frames actually shipped for one track, in filename order. */
const frameFiles = (track: string): string[] =>
  readdirSync(join(JYN_Q_DIR, 'frames', track)).filter(f => f.endsWith('.webp')).sort()

/**
 * Track length in ms as the host resolves it: the filename-encoded duration
 * suffix wins over the manifest's defaultFrameMs, so read the frames rather
 * than assuming the default cadence.
 */
const trackDurationMs = (track: string): number =>
  frameFiles(track).reduce((sum, file) => {
    const suffix = file.replace(/\.webp$/, '').split('_').pop()
    return sum + Number(suffix)
  }, 0)

describe('jyn-q pet manifest', () => {
  const parsed = JSON.parse(readFileSync(join(JYN_Q_DIR, 'pet.json'), 'utf8'))
  const res = parsePetManifest(parsed, 'jyn-q-assets')

  it('user gets a manifest that parses clean (fail-closed)', () => {
    // Given the shipped jyn-q manifest; when it is parsed; then it is accepted
    // with no error diagnostic.
    expect(res.ok).toBe(true)
    if (res.ok) {
      const errors = res.diagnostics.filter(d => d.level === 'error')
      expect(errors).toEqual([])
    }
  })

  it('user sees the eight declared tracks at the 120ms default cadence', () => {
    // Given the parsed manifest; when its track table is read; then every
    // track exists and none overrides the cadence.
    if (!res.ok) throw new Error('manifest rejected')
    const frames2d = res.manifest.frames2d!
    expect(Object.keys(frames2d.tracks).sort()).toEqual(Object.keys(TRACK_FRAMES).sort())
    expect(frames2d.defaultFrameMs).toBe(120)
    for (const [name, row] of Object.entries<Record<string, unknown>>(parsed.frames2d.tracks)) {
      for (const key of Object.keys(row)) expect(['loop', 'fallback'], name).toContain(key)
    }
  })

  it('user gets a reaction for every activity phase', () => {
    // Given the parsed phases table; when each phase is looked up; then it
    // names its own declared track rather than falling through to idle.
    if (!res.ok) throw new Error('manifest rejected')
    const frames2d = res.manifest.frames2d!
    expect(frames2d.phases.idle).toBe('idle')
    for (const phase of PHASES) {
      const track = frames2d.phases[phase]
      expect(track, phase).toBe(phase)
      expect(frames2d.tracks[track!], phase).toBeDefined()
    }
  })

  it('user sees the three one-shot reactions settle back into idle', () => {
    // Given the parsed tracks; when loop and fallback are read; then the
    // jump, the sulk and the tap reaction all replay from the idle loop.
    if (!res.ok) throw new Error('manifest rejected')
    const tracks = res.manifest.frames2d!.tracks
    for (const name of ONE_SHOT) {
      expect(tracks[name]!.loop, name).toBe(false)
      expect(tracks[name]!.fallback, name).toBe('idle')
    }
    // The phase loops keep running: they are held for as long as the phase lasts.
    for (const name of ['idle', 'waiting', 'thinking', 'tool', 'review']) {
      expect(tracks[name]!.loop ?? true, name).toBe(true)
      expect(tracks[name]!.fallback, name).toBeUndefined()
    }
  })

  it('ships the frames every track declares, all sharing one cell size', () => {
    // Given the frames on disk; when each track directory is listed; then the
    // counts match the manifest's tracks and every frame uses one cell, so the
    // pet does not jump when the phase changes.
    const cells = new Set<string>()
    for (const [track, expected] of Object.entries(TRACK_FRAMES)) {
      const files = frameFiles(track)
      expect(files.length, track).toBe(expected)
      for (const file of files) {
        const dim = imageDimensions(readFileSync(join(JYN_Q_DIR, 'frames', track, file)))
        expect(dim, track + '/' + file).toBeDefined()
        cells.add(dim!.width + 'x' + dim!.height)
      }
    }
    expect([...cells]).toEqual(['223x297'])
  })

  it('encodes each frame duration in the file name', () => {
    // Given the shipped frame names; when the duration suffix is read; then the
    // host resolves the declared cadence without a manifest frameMs list.
    for (const [track, ms] of [['idle', 125], ['tool', 90], ['done', 100]] as const) {
      const files = frameFiles(track)
      expect(files.every(f => f.endsWith('_' + ms + '.webp')), track).toBe(true)
    }
  })

  it('user sees the tap reaction play the happy track for its whole length', () => {
    // Given the parsed touch zones; when the branch hold window is read; then it
    // covers the animation, so the reaction is never cut off mid-jump.
    if (!res.ok) throw new Error('manifest rejected')
    const touch = res.manifest.gameplay?.touch
    if (!touch) throw new Error('touch zones missing')
    const animationMs = trackDurationMs('happy')
    expect(touch.zones.map(z => z.name)).toEqual(['head', 'body'])
    for (const zone of touch.zones) {
      expect(zone.y0, zone.name).toBeLessThan(zone.y1)
      const total = zone.branches.reduce((sum, b) => sum + b.probability, 0)
      expect(total, zone.name).toBeLessThanOrEqual(1)
      for (const branch of zone.branches) {
        expect(branch.state, zone.name).toBe('happy')
        expect(branch.stateMs ?? 0, zone.name).toBeGreaterThanOrEqual(animationMs)
      }
    }
    // The hit box stays inside the sprite box and is not degenerate.
    const box = res.manifest.gameplay?.hitBox
    if (!box) throw new Error('hit box missing')
    expect(box.x0).toBeLessThan(box.x1)
    expect(box.y0).toBeLessThan(box.y1)
    expect(box.x0).toBeGreaterThanOrEqual(0)
    expect(box.y1).toBeLessThanOrEqual(1)
  })
})
