/**
 * Affinity score — pure, clock-injected. The pet grows closer the more you
 * work together and care for it: every completed turn earns a small reward,
 * petting earns a tiny one (cooldown-gated), feeding earns the most.
 * Persistence lives in the service; this module only computes transitions.
 * Reaction copy resolves from the shared remark library (first line of each
 * built-in pool); the ledger layers per-pet custom remarks on top.
 * @module @linxin666/dsh-pet/affinity
 */

import { BUILTIN_REMARKS, builtinRemark } from './remarks.ts'

/** One interaction the user can perform on the pet. */
export type PetInteraction = 'pet' | 'feed'

/** Affinity state as persisted. */
export interface AffinityState {
  /** Total affinity points, capped at AFFINITY_MAX. */
  points: number
  /** Epoch ms of the last pet interaction. */
  lastPetAt: number
  /** Epoch ms of the last feed. */
  lastFeedAt: number
  /** Total pet count (lifetime). */
  pets: number
  /** Total feed count (lifetime). */
  feeds: number
  /** Total pet attempts rejected by cooldown (lifetime). */
  petRejects: number
  /** Total feed attempts rejected by cooldown (lifetime). */
  feedRejects: number
  /** Total completed turns witnessed (lifetime). */
  turns: number
}

/**
 * Affinity points cap. Historically 100; removed so long-term companions
 * keep growing — the default limit is now the full 999,999,999 range.
 */
export const AFFINITY_MAX = 999_999_999

/** Affinity ranks by points; the pet visibly grows with its rank.
 *  The original four tiers (0/25/50/80) are unchanged; higher tiers reach
 *  into the extended cap so the ladder stays meaningful for veteran
 *  companions. Marker glyphs are plain ASCII (the repo bans all emoji
 *  characters); they read as a growing star trail alongside the rank name. */
export const AFFINITY_RANKS = [
  { min: 0, name: '幼鲸', emoji: '*' },
  { min: 25, name: '伙伴', emoji: '**' },
  { min: 50, name: '挚友', emoji: '***' },
  { min: 80, name: '深海羁绊', emoji: '****' },
  { min: 200, name: '心有灵犀', emoji: '*****' },
  { min: 500, name: '传说羁绊', emoji: '******' },
  { min: 2_000, name: '神话羁绊', emoji: '*******' },
  { min: 10_000, name: '永恒之契', emoji: '********' },
  { min: 100_000, name: '鲸生共渡', emoji: '*********' },
] as const

/** One tier of a pet-declared affinity ladder (voice.json `panel.ranks`). */
export interface AffinityRankName {
  /** Minimum points for this tier; the first entry is always 0. */
  min: number
  /** Default rank name shown in every locale without an English variant. */
  name: string
  /** Optional English name used when the UI locale is English. */
  nameEn?: string
}

/** A resolved rank: the effective name plus the display-only marker. */
export interface AffinityRank {
  min: number
  name: string
  nameEn?: string
  emoji: string
}

/** English translations for the 9 built-in affinity rank names (#1226). */
export const AFFINITY_RANKS_EN: Readonly<Record<string, string>> = {
  '幼鲸': 'Baby Whale',
  '伙伴': 'Companion',
  '挚友': 'Close Friend',
  '深海羁绊': 'Deep Sea Bond',
  '心有灵犀': 'Kindred Spirit',
  '传说羁绊': 'Legendary Bond',
  '神话羁绊': 'Mythic Bond',
  '永恒之契': 'Eternal Covenant',
  '鲸生共渡': 'Lifelong Companion',
}

/** Interaction tuning (all in points / ms). */
export interface AffinityConfig {
  /** Points per completed turn. */
  turnReward: number
  /** Points per pet; applied only outside the pet cooldown. */
  petReward: number
  /** Cooldown between pets, ms. */
  petCooldownMs: number
  /** Points per feed. */
  feedReward: number
  /** Cooldown between feeds, ms. */
  feedCooldownMs: number
}

export const defaultAffinityConfig: AffinityConfig = {
  turnReward: 1,
  petReward: 1,
  petCooldownMs: 10_000,
  feedReward: 5,
  feedCooldownMs: 30_000,
}

export function emptyAffinity(): AffinityState {
  return {
    points: 0,
    lastPetAt: 0,
    lastFeedAt: 0,
    pets: 0,
    feeds: 0,
    petRejects: 0,
    feedRejects: 0,
    turns: 0,
  }
}

/** Outcome of one interaction. */
export interface InteractionOutcome {
  /** Mutated affinity state (caller persists it). */
  affinity: AffinityState
  /** Points actually gained (0 when inside the cooldown). */
  delta: number
  /** Human-readable reaction copy the UI shows as a bubble. */
  reaction: string
  /** True when the interaction was accepted (outside cooldown). */
  accepted: boolean
}

/** Built-in ladder lookup (the fallback for pets with no declared ladder). */
function builtinRankOf(points: number): (typeof AFFINITY_RANKS)[number] {
  let rank: (typeof AFFINITY_RANKS)[number] = AFFINITY_RANKS[0]!
  for (const candidate of AFFINITY_RANKS) {
    if (points >= candidate.min) rank = candidate
  }
  return rank
}

/**
 * Rank for a point total. A pet-declared ladder replaces the tier names while
 * the built-in ladder still supplies the display marker; without a ladder the
 * built-in ladder answers unchanged. Points, thresholds and the persisted
 * ledger are untouched — the ladder is a display-only rename.
 */
export function rankOf(points: number, ladder?: readonly AffinityRankName[]): AffinityRank {
  const builtin = builtinRankOf(points)
  if (ladder === undefined || ladder.length === 0) return builtin
  let selected = ladder[0]!
  for (const candidate of ladder) {
    if (points >= candidate.min) selected = candidate
  }
  return {
    min: selected.min,
    name: selected.name,
    ...(selected.nameEn === undefined ? {} : { nameEn: selected.nameEn }),
    emoji: builtin.emoji,
  }
}

/** Read-only affinity snapshot suited for the RPC view shape. */
export interface PetAffinityView {
  points: number
  rank: string
  /** English rank name when the pet declared one (an English UI shows this). */
  rankEn?: string
  rankEmoji: string
  pets: number
  feeds: number
  turns: number
  /** True while the pet interaction is inside its cooldown. */
  petCooldown: boolean
  /** True while the feed is inside its cooldown. */
  feedCooldown: boolean
}

/** Derive the read-only view of one affinity state at a wall-clock instant. */
export function affinityViewOf(
  state: AffinityState,
  nowMs: number,
  config: AffinityConfig = defaultAffinityConfig,
  ladder?: readonly AffinityRankName[],
): PetAffinityView {
  const rank = rankOf(state.points, ladder)
  return {
    points: state.points,
    rank: rank.name,
    ...(rank.nameEn === undefined ? {} : { rankEn: rank.nameEn }),
    rankEmoji: rank.emoji,
    pets: state.pets,
    feeds: state.feeds,
    turns: state.turns,
    petCooldown: nowMs - state.lastPetAt < config.petCooldownMs,
    feedCooldown: nowMs - state.lastFeedAt < config.feedCooldownMs,
  }
}

function clamp(points: number): number {
  return Math.min(AFFINITY_MAX, Math.max(0, points))
}

/** Built-in reaction selected deterministically from a persisted counter. */
function countedRemark(kind: 'pet' | 'petCooldown' | 'feed' | 'feedCooldown', count: number): string {
  const pool = BUILTIN_REMARKS[kind]
  return pool[Math.max(0, Math.floor(count)) % pool.length] ?? builtinRemark(kind)
}

/**
 * Apply one interaction to a copy of the state (immutable style: returns a
 * new object; the caller replaces the persisted state). Cooldowns only
 * apply once the pet has been interacted with at least once (last*At === 0
 * means "never", so the first pet/feed always lands).
 */
export function applyInteraction(
  state: AffinityState,
  kind: PetInteraction,
  nowMs: number,
  config: AffinityConfig = defaultAffinityConfig,
): InteractionOutcome {
  const next = { ...state }
  if (kind === 'pet') {
    if (state.lastPetAt !== 0 && nowMs - state.lastPetAt < config.petCooldownMs) {
      next.petRejects += 1
      return {
        affinity: next,
        delta: 0,
        reaction: countedRemark('petCooldown', state.petRejects),
        accepted: false,
      }
    }
    next.lastPetAt = nowMs
    next.pets += 1
    next.points = clamp(state.points + config.petReward)
    return {
      affinity: next,
      delta: config.petReward,
      reaction: countedRemark('pet', state.pets),
      accepted: true,
    }
  }
  if (kind === 'feed') {
    if (state.lastFeedAt !== 0 && nowMs - state.lastFeedAt < config.feedCooldownMs) {
      next.feedRejects += 1
      return {
        affinity: next,
        delta: 0,
        reaction: countedRemark('feedCooldown', state.feedRejects),
        accepted: false,
      }
    }
    next.lastFeedAt = nowMs
    next.feeds += 1
    next.points = clamp(state.points + config.feedReward)
    return {
      affinity: next,
      delta: config.feedReward,
      reaction: countedRemark('feed', state.feeds),
      accepted: true,
    }
  }
  return { affinity: state, delta: 0, reaction: '', accepted: false }
}

/** Reward one completed turn (called by the host on `done`). */
export function applyTurnReward(
  state: AffinityState,
  config: AffinityConfig = defaultAffinityConfig,
): AffinityState {
  const next = { ...state }
  next.turns += 1
  next.points = clamp(state.points + config.turnReward)
  return next
}
