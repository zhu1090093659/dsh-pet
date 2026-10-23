import { describe, expect, it } from 'vitest'
import {
  AFFINITY_MAX,
  AFFINITY_RANKS,
  affinityViewOf,
  applyInteraction,
  applyTurnReward,
  defaultAffinityConfig,
  emptyAffinity,
  rankOf,
} from './affinity.ts'

describe('applyInteraction', () => {
  it('accepts the first pet and grants the pet reward', () => {
    const now = 1_000_000
    const outcome = applyInteraction(emptyAffinity(), 'pet', now)
    expect(outcome.accepted).toBe(true)
    expect(outcome.delta).toBe(defaultAffinityConfig.petReward)
    expect(outcome.affinity.points).toBe(defaultAffinityConfig.petReward)
    expect(outcome.affinity.pets).toBe(1)
    expect(outcome.affinity.lastPetAt).toBe(now)
  })

  it('rejects a pet inside the cooldown without mutating state', () => {
    const now = 1_000_000
    const first = applyInteraction(emptyAffinity(), 'pet', now)
    const second = applyInteraction(first.affinity, 'pet', now + defaultAffinityConfig.petCooldownMs - 1)
    expect(second.accepted).toBe(false)
    expect(second.delta).toBe(0)
    expect(second.affinity).not.toBe(first.affinity)
    expect(second.affinity.pets).toBe(1)
    expect(second.affinity.petRejects).toBe(1)
  })

  it('accepts a pet again after the cooldown elapsed', () => {
    const now = 1_000_000
    const first = applyInteraction(emptyAffinity(), 'pet', now)
    const second = applyInteraction(first.affinity, 'pet', now + defaultAffinityConfig.petCooldownMs)
    expect(second.accepted).toBe(true)
    expect(second.affinity.pets).toBe(2)
  })

  it('rejects a feed inside the cooldown without spending anything', () => {
    const now = 1_000_000
    const first = applyInteraction(emptyAffinity(), 'feed', now)
    const second = applyInteraction(first.affinity, 'feed', now + defaultAffinityConfig.feedCooldownMs - 1)
    expect(second.accepted).toBe(false)
    expect(second.delta).toBe(0)
    expect(second.affinity).not.toBe(first.affinity)
    expect(second.affinity.feeds).toBe(1)
    expect(second.affinity.feedRejects).toBe(1)
  })

  it('clamps points at AFFINITY_MAX', () => {
    const state = { ...emptyAffinity(), points: AFFINITY_MAX - 1 }
    const outcome = applyInteraction(state, 'pet', 1_000_000)
    expect(outcome.affinity.points).toBe(AFFINITY_MAX)
    expect(outcome.affinity.points).toBe(999_999_999)
  })

  it('keeps the legacy first lines as the default reactions', () => {
    const outcome = applyInteraction(emptyAffinity(), 'pet', 1_000_000)
    expect(outcome.reaction).toBe('咕噜咕噜～被摸摸好舒服！')
    const feed = applyInteraction(emptyAffinity(), 'feed', 1_000_000)
    expect(feed.reaction).toBe('呜哇！小鱼干好好吃！')
  })
})

describe('applyTurnReward', () => {
  it('increments turns and points', () => {
    const next = applyTurnReward(emptyAffinity())
    expect(next.turns).toBe(1)
    expect(next.points).toBe(defaultAffinityConfig.turnReward)
  })
})

describe('rankOf', () => {
  it('maps point totals onto the rank ladder', () => {
    for (const rank of AFFINITY_RANKS) {
      expect(rankOf(rank.min).name).toBe(rank.name)
    }
    expect(rankOf(AFFINITY_MAX).name).toBe(AFFINITY_RANKS[AFFINITY_RANKS.length - 1]!.name)
    expect(rankOf(-1).name).toBe(AFFINITY_RANKS[0]!.name)
  })

  it('maps points onto a declared ladder while keeping the built-in marker', () => {
    const ladder = [
      { min: 0, name: '小煤球', nameEn: 'Little Coal Ball' },
      { min: 25, name: '火星伙伴', nameEn: 'Martian Buddy' },
      { min: 50, name: '煤球挚友' },
    ]
    expect(rankOf(0, ladder).name).toBe('小煤球')
    expect(rankOf(24, ladder).name).toBe('小煤球')
    expect(rankOf(25, ladder).name).toBe('火星伙伴')
    expect(rankOf(100_000, ladder).name).toBe('煤球挚友')
    // Display-only: the built-in tier still supplies the marker glyph.
    expect(rankOf(0, ladder).emoji).toBe(AFFINITY_RANKS[0]!.emoji)
    expect(rankOf(100_000, ladder).emoji).toBe(AFFINITY_RANKS[AFFINITY_RANKS.length - 1]!.emoji)
  })

  it('keeps the built-in names for a pet that declares no ladder', () => {
    expect(rankOf(0).name).toBe('幼鲸')
    expect(rankOf(100_000).name).toBe('鲸生共渡')
  })

  it('carries nameEn into the affinity view only when the ladder declares it', () => {
    const state = { ...emptyAffinity(), points: 25 }
    const declared = affinityViewOf(state, 0, defaultAffinityConfig, [
      { min: 0, name: '小煤球', nameEn: 'Little Coal Ball' },
      { min: 25, name: '火星伙伴', nameEn: 'Martian Buddy' },
    ])
    expect(declared.rank).toBe('火星伙伴')
    expect(declared.rankEn).toBe('Martian Buddy')
    expect(declared.points).toBe(25)
    expect(declared.rankEmoji).toBe(rankOf(25).emoji)

    const chineseOnly = affinityViewOf(state, 0, defaultAffinityConfig, [{ min: 0, name: '小煤球' }])
    expect(chineseOnly.rank).toBe('小煤球')
    expect(chineseOnly.rankEn).toBeUndefined()
  })

  it('does not change the point economy', () => {
    const outcome = applyInteraction(emptyAffinity(), 'feed', 1_000_000)
    expect(outcome.affinity.points).toBe(defaultAffinityConfig.feedReward)
  })

  it('extends past the removed 100 cap with higher tiers', () => {
    // The original four tiers keep their thresholds; the ladder now reaches
    // into the 999,999,999 range instead of freezing at 80 points.
    expect(rankOf(80).name).toBe('深海羁绊')
    expect(rankOf(200).name).toBe('心有灵犀')
    expect(rankOf(100_000).name).toBe('鲸生共渡')
    expect(rankOf(1_000_000).name).toBe('鲸生共渡')
    expect(AFFINITY_RANKS[AFFINITY_RANKS.length - 1]!.min).toBe(100_000)
    expect(AFFINITY_MAX).toBe(999_999_999)
  })
})
