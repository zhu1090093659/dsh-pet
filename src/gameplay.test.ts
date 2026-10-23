/**
 * Gameplay tests — the manifest block (fail-closed structure, parsed through
 * parsePetManifest) and the host engine (lazy settle, effects, rolls) with
 * injected clock/rng for determinism.
 */
import { describe, expect, it } from 'vitest'
import { parsePetManifest } from './manifest-v2.ts'
import {
  applyGameplayEffects,
  clampGameplay,
  declaredModes,
  isDeclaredMode,
  isOneShotMode,
  oneShotHoldMsOf,
  pickFeedTrack,
  drawLotteryTier,
  initialGameplayState,
  modeRestoreOf,
  modeStateOf,
  rollTouchBranch,
  rollWorkOutcome,
  settleGameplay,
  touchZoneAt,
  type PetGameplayManifest,
  type PetGameplayShopItem,
} from './gameplay.ts'

/** A miku-shaped frames2d manifest carrying the full gameplay block. */
function mikuManifest(gameplay: Record<string, unknown>): Record<string, unknown> {
  return {
    petManifestVersion: 2,
    id: 'miku',
    displayName: 'Miku',
    license: 'MIT',
    renderer: 'frames2d',
    frames2d: {
      dir: 'thumb',
      tracks: {
        idle: {}, drag: {}, standup: {}, sleep: {}, work: {}, success: {}, fail: {}, bath: {},
        happy: {}, shy: {}, flirty: {}, angry: {}, scratch: {}, blink1: {}, blink2: {}, eat: {}, shop: {},
      },
      phases: { idle: 'idle', done: 'success', failed: 'fail' },
    },
    gameplay,
  }
}

const FULL_GAMEPLAY: Record<string, unknown> = {
  idleDirector: {
    intervalMs: 5000,
    maxMiss: 2,
    idleWeight: 40,
    acts: [
      { track: 'scratch', weight: 18 },
      { track: 'blink1', weight: 9 },
      { track: 'blink2', weight: 9 },
      { track: 'eat', weight: 24 },
    ],
  },
  stats: {
    hunger: { max: 100, initial: 100, decayPerMinute: 1, workingDecayPerMinute: 5 },
    mood: { max: 100, initial: 100, decayPerMinute: 0.5 },
    energy: { max: 100, initial: 100, decayPerMinute: 0.25 },
    affection: { max: 500, initial: 100, idleDecayPerMinute: 0.2 },
  },
  hitBox: { x0: 0.2, y0: 0.05, x1: 0.42, y1: 0.56 },
  touch: {
    zones: [
      { name: 'head', y0: 0, y1: 0.55, branches: [{ probability: 0.05, effects: [{ stat: 'affection', amount: 5 }], state: 'happy', stateMs: 3000, phrases: ['hi'] }] },
      { name: 'body', y0: 0.55, y1: 0.75, branches: [{ probability: 0.1, effects: [{ stat: 'affection', amount: 10 }], state: 'shy', stateMs: 3000 }] },
      {
        name: 'legs', y0: 0.75, y1: 1, branches: [
          { probability: 0.1, effects: [{ stat: 'affection', amount: 30 }], state: 'flirty', stateMs: 3000 },
          { probability: 0.9, effects: [{ stat: 'affection', amount: -5 }], state: 'angry', stateMs: 3000 },
        ],
      },
    ],
  },
  work: {
    state: 'work',
    successState: 'success',
    failState: 'fail',
    tickMs: 10_000,
    resultMs: { success: 1300, fail: 1900 },
    successProbability: 0.5,
    success: { effects: [{ currency: 'coins', amount: 3 }] },
    fail: { effects: [{ currency: 'coins', amount: -1 }] },
  },
  sleep: { state: 'sleep', wakeState: 'standup', restore: { stat: 'energy', amount: 4, intervalMs: 30_000 } },
  passiveIncome: { currency: 'coins', amount: 1, intervalMs: 60_000 },
  shop: {
    state: 'shop',
    items: [
      { id: 'food1', label: 'bread', price: 5, currency: 'coins', effects: [{ stat: 'hunger', amount: 40 }] },
      { id: 'gamecoin', label: 'coin', price: 10, currency: 'coins', effects: [{ currency: 'gamecoins', amount: 1 }] },
      {
        id: 'lottery', label: 'ticket', price: 10, currency: 'gamecoins',
        lottery: {
          effects: [{ stat: 'hunger', amount: 10 }, { stat: 'mood', amount: 10 }, { stat: 'energy', amount: 10 }, { stat: 'affection', amount: 10 }],
          tiers: [
            { probability: 0.0001, prize: 1_000_000 },
            { probability: 0.9836, prize: 50 },
          ],
        },
      },
    ],
  },
  dragState: 'drag',
}

describe('gameplay manifest', () => {
  it('accepts the full miku-shaped block', () => {
    const result = parsePetManifest(mikuManifest(FULL_GAMEPLAY), 'mem')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const gameplay = result.manifest.gameplay!
    expect(gameplay.idleDirector?.acts).toHaveLength(4)
    expect(gameplay.stats?.affection?.max).toBe(500)
    expect(gameplay.touch?.zones).toHaveLength(3)
    expect(gameplay.work?.tickMs).toBe(10_000)
    expect(gameplay.sleep?.restore).toEqual({ stat: 'energy', amount: 4, intervalMs: 30_000 })
    expect(gameplay.shop?.items).toHaveLength(3)
    expect(gameplay.dragState).toBe('drag')
  })

  it('accepts a declared feed reaction track and rejects a dangling or malformed one', () => {    // Given gameplay.feed naming a declared track; when parsed; then the block
    // carries it (holdMs is optional) and the validator refuses a track that is
    // not declared, an unknown field, and an out-of-range hold.
    const ok = parsePetManifest(mikuManifest({ feed: { track: 'eat', holdMs: 1500 } }), 'mem')
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.manifest.gameplay?.feed).toEqual({ track: 'eat', holdMs: 1500 })
    const noHold = parsePetManifest(mikuManifest({ feed: { track: 'eat' } }), 'mem')
    expect(noHold.ok).toBe(true)
    if (noHold.ok) expect(noHold.manifest.gameplay?.feed).toEqual({ track: 'eat' })
    expect(parsePetManifest(mikuManifest({ feed: { track: 'ghost' } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ feed: { track: 'eat', loop: true } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ feed: { track: 'eat', holdMs: 10 } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ feed: { track: 'eat', holdMs: 60_000 } }), 'mem').ok).toBe(false)
  })

  it('accepts a feed states pool and rolls one track per feed', () => {
    // Given a pack that ships a rare extra reaction — three rice entries and one
    // basin entry, so a quarter of feeds flip the basin; when parsed; then the
    // pool lands on the block and the roll is uniform over it. The shorthand
    // `track` still parses, and an empty or dangling pool fails closed.
    const ok = parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      feed: { states: ['work', 'work', 'work', 'sleep'], holdMs: 4800 },
    }), 'mem')
    expect(ok.ok).toBe(true)
    expect(ok.ok && ok.manifest.gameplay?.feed).toEqual({ states: ['work', 'work', 'work', 'sleep'], holdMs: 4800 })
    const feed = ok.ok ? ok.manifest.gameplay?.feed : undefined

    // The odds are the pool's own frequencies: the injected rolls stay inside
    // each quarter, and a roll of exactly 1 must not index past the end.
    const at = (r: number): string | undefined => pickFeedTrack(feed, () => r)
    expect(at(0)).toBe('work')
    expect(at(0.74)).toBe('work')
    expect(at(0.75)).toBe('sleep')
    expect(at(0.999)).toBe('sleep')
    expect(at(1)).toBe('sleep')
    // A single-track reaction is the one-element pool.
    expect(pickFeedTrack({ track: 'work' }, () => 0.99)).toBe('work')
    expect(pickFeedTrack(undefined)).toBeUndefined()

    expect(parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      feed: { track: 'work' },
    }), 'mem').ok).toBe(true)
    expect(parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      feed: { states: [] },
    }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      feed: { states: ['ghost'] },
    }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      feed: { holdMs: 4800 },
    }), 'mem').ok).toBe(false)

    // A feed may also feed the pet: the effects ride the same block, so a pack
    // without a shop can still refill its bars. Unknown stats fail closed.
    const filled = parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      feed: {
        states: ['work', 'sleep'],
        effects: [{ stat: 'hunger', amount: 30 }],
      },
    }), 'mem')
    expect(filled.ok).toBe(true)
    expect(filled.ok && filled.manifest.gameplay?.feed?.effects).toEqual([{ stat: 'hunger', amount: 30 }])
    expect(parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      feed: { track: 'work', effects: [{ stat: 'ghost', amount: 1 }] },
    }), 'mem').ok).toBe(false)
  })

  it('accepts a stat mirrored off the affinity ledger', () => {
    // A pet whose "affection" bar should report the affinity points it actually
    // earns declares the stat as a mirror: projection-only, never stored or
    // decayed, so the bar cannot sit at its initial value while the ledger
    // climbs into the hundreds. Any other mirror source fails closed.
    const ok = parsePetManifest(mikuManifest({
      stats: {
        hunger: { max: 100 },
        affection: { max: 5000, mirror: 'affinity' },
      },
    }), 'mem')
    expect(ok.ok).toBe(true)
    expect(ok.ok && ok.manifest.gameplay?.stats?.affection).toEqual({ max: 5000, mirror: 'affinity' })

    expect(parsePetManifest(mikuManifest({
      stats: { affection: { max: 100, mirror: 'mood' } },
    }), 'mem').ok).toBe(false)
  })

  it('holds a stat at its affinity floor once it decays below it', () => {
    // The relationship is permanent progress; the daily stat is not. A floor of
    // affinity/divisor lets affection starve and refill like the other bars but
    // never fall under what a long friendship guarantees — the middle ground
    // between "two unrelated numbers" and "a bar that cannot move".
    const parsed = parsePetManifest(mikuManifest({
      stats: {
        affection: { max: 100, initial: 100, decayPerMinute: 10, affinityFloorDivisor: 10 },
      },
    }), 'mem')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.manifest.gameplay === undefined) return
    const def = parsed.manifest.gameplay
    const state = initialGameplayState(def, 0)
    state.stats.affection = 40
    state.settledAt = 0
    // 10 minutes at 10/min would drain it to zero; 822 affinity holds it at 82.2.
    settleGameplay(state, def, 10 * 60_000, { sessionActive: true, affinityPoints: 822 })
    expect(state.stats.affection).toBeCloseTo(82.2, 5)
    // A lower affinity lowers the floor, and decay gets closer to the bottom.
    settleGameplay(state, def, 20 * 60_000, { sessionActive: true, affinityPoints: 100 })
    expect(state.stats.affection).toBeCloseTo(10, 5)
    // Without an affinity total there is no floor: plain decay clamps at zero.
    state.stats.affection = 5
    settleGameplay(state, def, 30 * 60_000, { sessionActive: true })
    expect(state.stats.affection).toBe(0)
  })

  it('accepts workEntry / workExit session beats and refuses unusable ones', () => {
    // Given a pack that wants a walk-to-desk beat when a session starts and a
    // bookend when it ends; when parsed; then both land on the gameplay block
    // with their hold times. A dangling track, an out-of-range hold and an
    // unknown field all fail closed, exactly like the feed reaction.
    const ok = parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      workEntry: { track: 'work', holdMs: 3600 },
      workExit: { track: 'happy' },
    }), 'mem')
    expect(ok.ok).toBe(true)
    expect(ok.ok && ok.manifest.gameplay?.workEntry).toEqual({ track: 'work', holdMs: 3600 })
    expect(ok.ok && ok.manifest.gameplay?.workExit).toEqual({ track: 'happy' })

    const none = parsePetManifest(mikuManifest({ stats: { hunger: { max: 100 } } }), 'mem')
    expect(none.ok).toBe(true)
    expect(none.ok && none.manifest.gameplay?.workEntry).toBeUndefined()
    expect(none.ok && none.manifest.gameplay?.workExit).toBeUndefined()

    expect(parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      workEntry: { track: 'ghost' },
    }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      workEntry: { track: 'work', holdMs: 100 },
    }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      workEntry: { track: 'work', extra: 1 },
    }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      workExit: 'work',
    }), 'mem').ok).toBe(false)

    // The abnormal-ending beat parses like the other two and fails closed the
    // same way: it is the pet's "cut short" beat when a turn is interrupted,
    // so a dangling track would leave the sprite on whoever owned it.
    const cut = parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      workInterrupt: { track: 'fail', holdMs: 2400 },
    }), 'mem')
    expect(cut.ok).toBe(true)
    expect(cut.ok && cut.manifest.gameplay?.workInterrupt).toEqual({ track: 'fail', holdMs: 2400 })
    expect(parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      workInterrupt: { track: 'ghost' },
    }), 'mem').ok).toBe(false)
  })

  it('accepts gameplay.blockPhases and refuses unusable ones', () => {
    // Given a pack that locks gameplay out of its work phases; when parsed;
    // then the phase list lands on the gameplay block. 'idle' is refused (a pet
    // that blocks idle would never accept an interaction at all), as are
    // unknown phases, an empty list and a non-array.
    const ok = parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      blockPhases: ['thinking', 'tool', 'review'],
    }), 'mem')
    expect(ok.ok).toBe(true)
    expect(ok.ok && ok.manifest.gameplay?.blockPhases).toEqual(['thinking', 'tool', 'review'])

    const none = parsePetManifest(mikuManifest({ stats: { hunger: { max: 100 } } }), 'mem')
    expect(none.ok).toBe(true)
    expect(none.ok && none.manifest.gameplay?.blockPhases).toBeUndefined()

    const blockedIdle = parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      blockPhases: ['idle'],
    }), 'mem')
    expect(blockedIdle.ok).toBe(false)

    const unknownPhase = parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      blockPhases: ['sleeping'],
    }), 'mem')
    expect(unknownPhase.ok).toBe(false)

    const empty = parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      blockPhases: [],
    }), 'mem')
    expect(empty.ok).toBe(false)

    const notArray = parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      blockPhases: 'thinking',
    }), 'mem')
    expect(notArray.ok).toBe(false)

    // Duplicates collapse instead of being rejected: the list is a set.
    const duplicated = parsePetManifest(mikuManifest({
      stats: { hunger: { max: 100 } },
      blockPhases: ['tool', 'tool', 'thinking'],
    }), 'mem')
    expect(duplicated.ok).toBe(true)
    expect(duplicated.ok && duplicated.manifest.gameplay?.blockPhases).toEqual(['tool', 'thinking'])
  })

  it('rejects gameplay on non-frames2d renderers', () => {
    const sprite = {
      petManifestVersion: 2, id: 'cat', displayName: 'Cat', license: 'CC0-1.0',
      renderer: 'sprite2d', sprite2d: { spritesheetPath: 'spritesheet.webp' },
      gameplay: {},
    }
    const result = parsePetManifest(sprite, 'mem')
    expect(result.ok).toBe(false)
  })

  it('rejects unknown fields and dangling references', () => {
    expect(parsePetManifest(mikuManifest({ ...FULL_GAMEPLAY, casino: {} }), 'mem').ok).toBe(false)
    const badStatRef = mikuManifest({ stats: { hunger: { max: 100 } }, shop: { items: [{ id: 'x', label: 'x', price: 1, currency: 'coins', effects: [{ stat: 'ghost', amount: 1 }] }] } })
    expect(parsePetManifest(badStatRef, 'mem').ok).toBe(false)
    const badTrackRef = mikuManifest({ work: { state: 'ghost', successState: 'success', failState: 'fail', tickMs: 1000, successProbability: 0.5 } })
    expect(parsePetManifest(badTrackRef, 'mem').ok).toBe(false)
  })

  it('rejects probability sums above 1 and duplicate shop ids', () => {
    const overTouch = mikuManifest({ touch: { zones: [{ name: 'z', y0: 0, y1: 1, branches: [{ probability: 0.6 }, { probability: 0.6 }] }] } })
    expect(parsePetManifest(overTouch, 'mem').ok).toBe(false)
    const dupShop = mikuManifest({ shop: { items: [
      { id: 'a', label: 'a', price: 1, currency: 'c', effects: [{ currency: 'c', amount: 1 }] },
      { id: 'a', label: 'b', price: 1, currency: 'c', effects: [{ currency: 'c', amount: 1 }] },
    ] } })
    expect(parsePetManifest(dupShop, 'mem').ok).toBe(false)
  })

  it('rejects a shop item with neither effects nor lottery', () => {
    const bare = mikuManifest({ shop: { items: [{ id: 'a', label: 'a', price: 1, currency: 'coins' }] } })
    expect(parsePetManifest(bare, 'mem').ok).toBe(false)
  })

  it('user declares extra named modes and sees them listed after sleep', () => {
    // Given a manifest that adds two named modes; when it is parsed; then both
    // modes survive and the declared list appends them after sleep.
    const withModes = mikuManifest({
      ...FULL_GAMEPLAY,
      modes: {
        bath: { state: 'bath', label: 'Bath', activeLabel: 'Bathing', restore: { stat: 'mood', amount: 3, intervalMs: 1000 } },
        play: { state: 'happy' },
      },
    })
    const result = parsePetManifest(withModes, 'mem')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const gameplay = result.manifest.gameplay!
    expect(gameplay.modes?.bath).toEqual({
      state: 'bath', label: 'Bath', activeLabel: 'Bathing',
      restore: { stat: 'mood', amount: 3, intervalMs: 1000 },
    })
    expect(gameplay.modes?.play).toEqual({ state: 'happy' })
    expect(declaredModes(gameplay)).toEqual(['sleep', 'bath', 'play'])
  })

  it('user declares a one-shot mode and it round-trips without a restore', () => {
    // Given a mode marked once with a hold time; when parsed; then it survives,
    // reads as one-shot, exposes its hold, and modeRestoreOf reports nothing
    // (a one-shot mode never becomes active host-side, so it can never restore).
    const withOnce = mikuManifest({
      ...FULL_GAMEPLAY,
      modes: { feeding: { state: 'eat', label: '投喂', once: true, holdMs: 3400 } },
    })
    const result = parsePetManifest(withOnce, 'mem')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const gameplay = result.manifest.gameplay!
    expect(gameplay.modes?.feeding).toEqual({ state: 'eat', label: '投喂', once: true, holdMs: 3400 })
    expect(isOneShotMode(gameplay, 'feeding')).toBe(true)
    expect(oneShotHoldMsOf(gameplay, 'feeding')).toBe(3400)
    expect(modeRestoreOf(gameplay, 'feeding')).toBeUndefined()
    // A held mode and the reserved loops are never one-shot.
    expect(isOneShotMode(gameplay, 'sleep')).toBe(false)
    expect(isOneShotMode(gameplay, 'work')).toBe(false)
    expect(oneShotHoldMsOf(gameplay, 'sleep')).toBeUndefined()
    // Omitting the explicit `once` reads as a held mode, not a one-shot.
    const plain = parsePetManifest(mikuManifest({ ...FULL_GAMEPLAY, modes: { play: { state: 'happy' } } }), 'mem')
    expect(plain.ok).toBe(true)
    if (plain.ok) {
      expect(isOneShotMode(plain.manifest.gameplay!, 'play')).toBe(false)
      expect(plain.manifest.gameplay!.modes?.play).toEqual({ state: 'happy' })
    }
  })

  it('rejects a one-shot mode that contradicts itself', () => {
    // A once mode has no active window, so a restore cadence is a contradiction
    // rather than something to silently drop; holdMs is ranged like feed.holdMs.
    const restoreOnOnce = mikuManifest({
      ...FULL_GAMEPLAY,
      modes: { feeding: { state: 'eat', once: true, restore: { stat: 'mood', amount: 3, intervalMs: 1000 } } },
    })
    expect(parsePetManifest(restoreOnOnce, 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ ...FULL_GAMEPLAY, modes: { feeding: { state: 'eat', once: 'yes' } } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ ...FULL_GAMEPLAY, modes: { feeding: { state: 'eat', once: true, holdMs: 100 } } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ ...FULL_GAMEPLAY, modes: { feeding: { state: 'eat', once: true, holdMs: 60_000 } } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ ...FULL_GAMEPLAY, modes: { feeding: { state: 'ghost', once: true } } }), 'mem').ok).toBe(false)
  })

  it('user declares a roam block and malformed ones are rejected', () => {
    // Given a valid roam block; when it is parsed; then it round-trips while
    // malformed variants fail closed.
    const roam = { state: 'happy', intervalMs: 12_000, probability: 0.5, distanceMin: 80, distanceMax: 220, speed: 90 }
    const parsed = parsePetManifest(mikuManifest({ ...FULL_GAMEPLAY, roam }), 'mem')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.manifest.gameplay?.roam).toEqual(roam)
    expect(parsePetManifest(mikuManifest({ roam: { ...roam, state: 'ghost' } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ roam: { ...roam, distanceMin: 300, distanceMax: 100 } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ roam: { ...roam, probability: 0 } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ roam: { ...roam, speed: 0 } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ roam: { ...roam, sparkle: true } }), 'mem').ok).toBe(false)
  })

  it('user restricts the roam directions to a declared subset', () => {
    // Given a roam block; when directions are omitted or restricted; then the
    // default four apply and a bad list fails closed.
    const roam = { state: 'happy', intervalMs: 15_000, probability: 0.2, distanceMin: 80, distanceMax: 220, speed: 90 }
    const plain = parsePetManifest(mikuManifest({ ...FULL_GAMEPLAY, roam }), 'mem')
    expect(plain.ok).toBe(true)
    if (!plain.ok) return
    expect(plain.manifest.gameplay?.roam?.directions).toBeUndefined()
    const restricted = parsePetManifest(mikuManifest({ ...FULL_GAMEPLAY, roam: { ...roam, directions: ['left', 'right'] } }), 'mem')
    expect(restricted.ok).toBe(true)
    if (!restricted.ok) return
    expect(restricted.manifest.gameplay?.roam?.directions).toEqual(['left', 'right'])
    expect(parsePetManifest(mikuManifest({ roam: { ...roam, directions: [] } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ roam: { ...roam, directions: ['left', 'left'] } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ roam: { ...roam, directions: ['sideways'] } }), 'mem').ok).toBe(false)
  })

  it('user drops a persisted mode the manifest no longer declares', () => {
    // Given a manifest with one extra mode; when the persisted ids are checked;
    // then only declared ids (never prototype keys) count.
    const parsed = parsePetManifest(mikuManifest({
      ...FULL_GAMEPLAY,
      modes: { bath: { state: 'happy' } },
    }), 'mem')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const def = parsed.manifest.gameplay!
    expect(isDeclaredMode(def, 'work')).toBe(true)
    expect(isDeclaredMode(def, 'sleep')).toBe(true)
    expect(isDeclaredMode(def, 'bath')).toBe(true)
    // A mode that was persisted before the manifest dropped it is not declared.
    expect(isDeclaredMode(def, 'wash')).toBe(false)
    expect(isDeclaredMode(def, 'ghost')).toBe(false)
    // Object.prototype members must never count as declared modes.
    expect(isDeclaredMode(def, 'constructor')).toBe(false)
    expect(isDeclaredMode(def, 'toString')).toBe(false)
    expect(modeStateOf(def, 'constructor')).toBeUndefined()
    expect(modeRestoreOf(def, 'constructor')).toBeUndefined()
  })

  it('user cannot declare malformed or reserved extra modes', () => {
    // Given reserved and malformed mode blocks; when each is parsed; then every
    // one of them fails closed.
    expect(parsePetManifest(mikuManifest({ modes: { sleep: { state: 'bath' } } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ modes: { work: { state: 'bath' } } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ modes: { bath: { state: 'ghost' } } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ modes: { bath: { state: 'bath', sparkle: true } } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ modes: { bath: { state: 'bath', restore: { stat: 'ghost', amount: 3, intervalMs: 1000 } } } }), 'mem').ok).toBe(false)
    expect(parsePetManifest(mikuManifest({ modes: { bath: { state: 'bath', restore: { stat: 'mood', amount: 3, intervalMs: 10 } } } }), 'mem').ok).toBe(false)
  })

  it('rejects bad ranges (tickMs, decay, zone slices, stateMs)', () => {
    const badTick = mikuManifest({ work: { state: 'work', successState: 'success', failState: 'fail', tickMs: 50, successProbability: 0.5 } })
    expect(parsePetManifest(badTick, 'mem').ok).toBe(false)
    const badDecay = mikuManifest({ stats: { hunger: { max: 100, decayPerMinute: -1 } } })
    expect(parsePetManifest(badDecay, 'mem').ok).toBe(false)
    const badZone = mikuManifest({ touch: { zones: [{ name: 'z', y0: 0.8, y1: 0.2, branches: [{ probability: 1 }] }] } })
    expect(parsePetManifest(badZone, 'mem').ok).toBe(false)
  })
})

describe('gameplay engine', () => {
  const manifest = parsePetManifest(mikuManifest(FULL_GAMEPLAY), 'mem')
  if (!manifest.ok) throw new Error('fixture must parse')
  const def = manifest.manifest.gameplay!

  it('initializes stats at their declared initial (default max)', () => {
    const state = initialGameplayState(def, 1000)
    expect(state.stats).toEqual({ hunger: 100, mood: 100, energy: 100, affection: 100 })
    expect(state.currencies).toEqual({})
    expect(state.mode).toBeNull()
  })

  it('lazy-settles decay, passive income and sleep restore', () => {
    const state = initialGameplayState(def, 0)
    state.stats.hunger = 50
    state.mode = 'sleep'
    // 10 minutes pass with an active session: hunger -10 (1/min), mood -5,
    // energy -2.5 then +20 sleep restore (10 x 30s ticks x 4), coins +10.
    const changed = settleGameplay(state, def, 600_000, { sessionActive: true })
    expect(changed).toBe(true)
    expect(state.stats.hunger).toBe(40)
    expect(state.stats.mood).toBe(95)
    expect(state.stats.energy).toBe(100) // 97.5 + 20 clamped to max
    expect(state.currencies.coins).toBe(10)
    expect(state.settledAt).toBe(600_000)
  })

  it('user activates a declared extra mode and its restore ticks', () => {
    // Given a manifest with a bath mode; when the pet sits in it; then the mode
    // restore pays mood on its own interval.
    const parsed = parsePetManifest(mikuManifest({
      ...FULL_GAMEPLAY,
      modes: { bath: { state: 'bath', label: 'Bath', restore: { stat: 'mood', amount: 3, intervalMs: 1000 } } },
    }), 'mem')
    if (!parsed.ok) throw new Error('fixture must parse')
    const bathDef = parsed.manifest.gameplay!
    expect(modeStateOf(bathDef, 'bath')).toBe('bath')
    expect(modeRestoreOf(bathDef, 'bath')).toEqual({ stat: 'mood', amount: 3, intervalMs: 1000 })
    expect(modeRestoreOf(bathDef, 'work')).toBeUndefined()
    expect(modeRestoreOf(bathDef, null)).toBeUndefined()

    const state = initialGameplayState(bathDef, 0)
    state.stats.mood = 10
    state.mode = 'bath'
    // 5 s of bath: 5 x 3 mood, minus 5 s of the 0.5/min baseline decay
    settleGameplay(state, bathDef, 5000, { sessionActive: true })
    expect(state.stats.mood).toBeCloseTo(10 - (5 / 60) * 0.5 + 15, 4)
  })

  it('user keeps a 1 s mode cadence across a fast polling interval', () => {
    // Given a fast 200 ms poll loop; when ten seconds elapse; then the mode
    // still pays exactly ten ticks with no drift.
    const parsed = parsePetManifest(mikuManifest({
      ...FULL_GAMEPLAY,
      modes: { bath: { state: 'bath', restore: { stat: 'mood', amount: 3, intervalMs: 1000 } } },
    }), 'mem')
    if (!parsed.ok) throw new Error('fixture must parse')
    const bathDef = parsed.manifest.gameplay!
    // Start above zero: a stat parked at 0 is exempt from decay, which would
    // otherwise hide part of the decay side of the balance.
    const state = initialGameplayState(bathDef, 0)
    state.stats.mood = 50
    state.mode = 'bath'
    let now = 0
    for (let i = 0; i < 50; i++) {
      now += 200
      settleGameplay(state, bathDef, now, { sessionActive: true })
    }
    // 10 s of 200 ms polls still pays exactly 10 x 3 mood (carry, no drift)
    expect(state.stats.mood).toBeCloseTo(50 + 30 - (10 / 60) * 0.5, 4)
  })

  it('preserves remainder carry across frequent polling intervals for passive income and sleep restore (#1478)', () => {
    const state = initialGameplayState(def, 0)
    state.stats.energy = 20
    state.mode = 'sleep'
    // Simulate 30 frequent settles every 2,000 ms (total 60,000 ms = 1 min).
    // Passive income interval: 60,000 ms -> should grant 1 coin on 30th settle.
    // Sleep restore interval: 30,000 ms (+4 energy each) -> should grant on 15th and 30th settle.
    let now = 0
    for (let i = 1; i <= 30; i++) {
      now += 2_000
      settleGameplay(state, def, now, { sessionActive: true })
      if (i < 15) {
        expect(state.stats.energy).toBeCloseTo(20 - (i * 2 / 60) * 0.25, 4)
        expect(state.currencies.coins ?? 0).toBe(0)
      } else if (i === 15) {
        // At 30,000 ms: first sleep tick hits (+4 energy)
        expect(state.stats.energy).toBeCloseTo(20 - 0.125 + 4, 4)
        expect(state.currencies.coins ?? 0).toBe(0)
      } else if (i < 30) {
        expect(state.stats.energy).toBeCloseTo(20 - (i * 2 / 60) * 0.25 + 4, 4)
        expect(state.currencies.coins ?? 0).toBe(0)
      }
    }
    // At 60,000 ms (30th tick): second sleep tick hits (+4 energy = +8 total), passive income hits (+1 coin)
    expect(state.stats.energy).toBeCloseTo(20 - 0.25 + 8, 4)
    expect(state.currencies.coins).toBe(1)
    expect(state.incomeCarryMs).toBe(0)
    expect(state.restoreCarryMs).toBe(0)

    // Leaving sleep mode clears restoreCarryMs
    state.restoreCarryMs = 10_000
    state.mode = null
    settleGameplay(state, def, now + 1_000, { sessionActive: true })
    expect(state.restoreCarryMs).toBe(0)
  })

  it('applies the working decay variant while working and idle decay without a session', () => {
    const state = initialGameplayState(def, 0)
    state.mode = 'work'
    settleGameplay(state, def, 60_000, { sessionActive: true })
    expect(state.stats.hunger).toBe(95) // working: 5/min
    const idle = initialGameplayState(def, 0)
    settleGameplay(idle, def, 300_000, { sessionActive: false })
    expect(idle.stats.affection).toBe(99) // idle decay 0.2/min over 5 min
  })

  it('clamps effects into stat max and currency floors', () => {
    const state = initialGameplayState(def, 0)
    applyGameplayEffects(state, def, [{ stat: 'affection', amount: 10_000 }, { currency: 'coins', amount: -5 }])
    expect(state.stats.affection).toBe(500)
    expect(state.currencies.coins).toBe(0)
  })

  it('rolls touch branches by cumulative probability with no-op mass', () => {
    const zone = def.touch!.zones[0]! // head: 5% hit
    expect(rollTouchBranch(zone, () => 0.04)?.state).toBe('happy')
    expect(rollTouchBranch(zone, () => 0.5)).toBeUndefined()
    const legs = def.touch!.zones[2]!
    expect(rollTouchBranch(legs, () => 0.05)?.state).toBe('flirty')
    expect(rollTouchBranch(legs, () => 0.5)?.state).toBe('angry')
  })

  it('rolls work outcomes and draws lottery tiers with fallthrough', () => {
    expect(rollWorkOutcome(def.work!, () => 0.4)).toBe('success')
    expect(rollWorkOutcome(def.work!, () => 0.6)).toBe('fail')
    const lottery = def.shop!.items[2]!.lottery!
    expect(drawLotteryTier(lottery, () => 0.00005).prize).toBe(1_000_000)
    expect(drawLotteryTier(lottery, () => 0.5).prize).toBe(50)
    // Sum < 1: the uncovered roll mass falls through to the last tier.
    expect(drawLotteryTier(lottery, () => 0.9999).prize).toBe(50)
  })

  it('locates the touch zone for a hit-box fraction', () => {
    expect(touchZoneAt(def.touch!, 0.3)?.name).toBe('head')
    expect(touchZoneAt(def.touch!, 0.6)?.name).toBe('body')
    expect(touchZoneAt(def.touch!, 0.9)?.name).toBe('legs')
    expect(touchZoneAt(def.touch!, 0.55)?.name).toBe('body')
  })

  it('clamps gameplay state into declared maxima', () => {
    const state = initialGameplayState(def, 0)
    state.stats.hunger = 10_000
    state.currencies.coins = 100_000_000
    clampGameplay(state, def)
    expect(state.stats.hunger).toBe(100)
    expect(state.currencies.coins).toBe(9_999_999)
  })
})
