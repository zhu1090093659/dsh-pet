/**
 * Pet gameplay — the optional manifest 'gameplay' block and its host engine.
 * The block layers an opt-in mini-game over any frames2d pet: decaying stat
 * bars, currencies, a weighted idle director, touch zones, a work loop, a
 * sleep loop, passive income and a shop (issue: miku-pet generalization).
 *
 * Discipline split matches manifest-v2: STRUCTURE is fail-closed (types,
 * ranges, references into stats/tracks); the host engine is pure — every
 * verb takes an explicit clock and rng so tests stay deterministic. Decay,
 * passive income and sleep restore are lazy-settled on read (the treats.ts
 * discipline): the host runs no timers for gameplay.
 * @module @linxin666/dsh-pet/gameplay
 */

import type { ActivityPhase } from './state.ts'

/** One roam direction the pet may walk in. */
export type PetRoamDirection = 'up' | 'down' | 'left' | 'right'

/** Every roam direction, in roll order (equal chance each unless restricted). */
export const PET_ROAM_DIRECTIONS: readonly PetRoamDirection[] = ['up', 'down', 'left', 'right']

/** One gameplay effect: add amount to a declared stat or a currency. */
export interface PetGameplayEffect {
  stat?: string
  currency?: string
  amount: number
}

/** One roll branch inside a touch zone; uncovered roll mass is a no-op. */
export interface PetGameplayTouchBranch {
  probability: number
  effects?: PetGameplayEffect[]
  /** Track played on hit (held for stateMs, then the renderer settles). */
  state?: string
  stateMs?: number
  /** Bubble phrase pool; one is picked on hit. */
  phrases?: string[]
}

export interface PetGameplayTouchZone {
  name: string
  /** Vertical slice of the hit box (fractions, y0 < y1). */
  y0: number
  y1: number
  branches: PetGameplayTouchBranch[]
}

export interface PetGameplayStatDef {
  max: number
  initial?: number
  decayPerMinute?: number
  /** Decay rate while the work mode is active (defaults to decayPerMinute). */
  workingDecayPerMinute?: number
  /** Extra decay rate while no session is active. */
  idleDecayPerMinute?: number
  /**
   * Read this stat straight off the affinity ledger instead of storing it.
   *
   * A pet's "affection" is the same idea the ledger already tracks as points,
   * and the plugin has always had both: a stored stat that starts at 100 and
   * decays, next to a ledger that climbs to hundreds through pets and feeds.
   * They disagree the moment the pet is used, which reads as a broken bar. A
   * mirrored stat is projection-only — never persisted, never decayed, clamped
   * to `max` — so the bar simply reports the real number.
   */
  mirror?: 'affinity'
  /**
   * A floor derived from the affinity ledger: this stat never settles below
   * `affinityPoints / affinityFloorDivisor` (capped at `max`).
   *
   * The gentler alternative to `mirror`. A mirrored bar can never fall at all,
   * which makes neglect meaningless; a floor lets the stat decay, feed and
   * starve like the others while the relationship itself stays as a safety net.
   * With a divisor of 10, 100 affinity guarantees 10 and 1000 guarantees the
   * whole bar.
   */
  affinityFloorDivisor?: number
}

export interface PetGameplayShopItem {
  id: string
  label: string
  /** Optional frame path (manifest-relative) shown as the item icon. */
  image?: string
  price: number
  currency: string
  effects?: PetGameplayEffect[]
  lottery?: {
    effects?: PetGameplayEffect[]
    /** Default currency the prize is paid in (tiers may override). */
    currency?: string
    tiers: { probability: number; prize: number; currency?: string }[]
  }
}

/**
 * One extra named gameplay mode beyond work/sleep (a bath, a play session…).
 * The host holds `state` while the mode is active and may restore a stat on
 * a fixed cadence — the same lazy-settle rule the sleep mode uses. A mode is
 * pure data: adding one to a manifest needs no host change.
 */
export interface PetGameplayModeDef {
  /** frames2d track held for as long as the mode is active. */
  state: string
  /** Action-button label (plain text); falls back to the i18n key pet.gameplay.<name>. */
  label?: string
  /** Label while the mode is active (plain text); falls back to `label`. */
  activeLabel?: string
  /** Periodic stat restore while the mode is active (omitted = no restore). */
  restore?: { stat: string; amount: number; intervalMs: number }
  /**
   * Run the mode's track once and settle back, instead of holding it until the
   * button is pressed again.
   *
   * A held mode owns the pet for as long as it is active — the pet cannot be
   * petted, the mode chip stays on screen and the button becomes an "exit"
   * button. That is right for a bath or a nap, but wrong for a single reaction
   * an action button should show (eating a cake, a wave): the pet would stay
   * stuck in it. With `once` the button becomes a one-shot: it plays `state`
   * for `holdMs`, drops the override, and the pet returns to whatever it was
   * doing. No mode is entered host-side, so nothing has to be exited and the
   * next tap is a normal interaction again. `restore` is meaningless here and
   * is ignored.
   */
  once?: boolean
  /**
   * Hold time in ms for a `once` mode (defaults to the track's own play time,
   * or 2000 when the track is empty/undeclared). Ignored without `once`.
   */
  holdMs?: number
}

/**
 * One panel-button reaction animation ('gameplay.feed').
 *
 * `track` names a declared frames2d track played once when the interaction
 * lands; its own `loop`/`fallback` rules decide where the pet settles after.
 * The browser half holds the override for `holdMs`, during which the pet
 * refuses to be re-triggered: taps do not cut the animation short and a second
 * panel click is dropped instead of restarting it.
 */
export interface PetGameplayFeedDef {
  /** frames2d track played once for a landed interaction. */
  track?: string
  /**
   * A pool rolled per landed interaction instead of always playing `track`.
   *
   * Same shape as a shop item's `states`, and the pick is uniform, so the odds
   * are set by how often a track appears in the list — three rice entries and
   * one basin entry is a 25% basin. It exists so a pet can ship a rare extra
   * reaction without a second button or any per-pet code.
   */
  states?: string[]
  /**
   * How long the override is held, in ms. Also the interruption lock window,
   * so it should match the track's play time. Defaults to 2000.
   */
  holdMs?: number
  /**
   * Stat changes a landed interaction applies, exactly like a shop item's
   * effects.
   *
   * Without this a feed only moves affinity: the stat bars decay and nothing
   * ever fills them back up, because the shop is optional and was the only
   * other effects source. Declaring effects here makes the feed button the way
   * a pet gets fed, with the bars as the visible consequence.
   */
  effects?: PetGameplayEffect[]
  /**
   * workEntry only: how long the pet must have been OUT of work for the next
   * work phase to count as a new burst. Defaults to 6000.
   *
   * This is the knob that decides how often the entry animation is seen. Too
   * short and every reply-then-message cycle replays it, which reads as random;
   * a minute or two means it only plays when the player actually walked away.
   */
  gapMs?: number
}

/** The validated manifest 'gameplay' block. */
export interface PetGameplayManifest {
  /**
   * The action a panel-button interaction plays on the pet.
   *
   * The panel's pet/feed buttons live in the plugin's injected actions and
   * have no access to the renderer's track override, so a click there used to
   * move the economy and speak a bubble without ever changing the sprite. This
   * block hands the browser half a per-pet track to hold for those
   * interactions — the same one-shot override the touch zones and the skin
   * click actions use — so a pet can ship its own feed animation without any
   * per-pet code.
   */
  feed?: PetGameplayFeedDef
  /**
   * Activity phases during which the gameplay layer is locked out.
   *
   * A pet that maps its ActivityPhases onto work art (a walk-to-desk entry, a
   * working loop, a wrap-up) owns the sprite for as long as the agent is busy.
   * Letting a purchase, a feed button or a pet click grab the same track
   * override mid-animation makes the sprite flip between "working" and
   * "eating", which reads as a rendering bug rather than as two features.
   *
   * Declaring the phases here makes the browser half refuse those interactions
   * and gray the buttons instead, so the work animation keeps the sprite. The
   * panel still opens: stats and the shop stay readable, only the actions that
   * would steal the track are refused.
   */
  blockPhases?: ActivityPhase[]
  /**
   * A one-shot reaction played when a session becomes active — the "the agent
   * started working" beat.
   *
   * The phase stream cannot express this. Its `waiting` phase fires at EVERY
   * turn start, every step start and whenever the agent blocks for approval, so
   * binding a walk-to-desk animation to it replays it several times per task —
   * and DSH chains turns, so a delivered stage immediately starts a new one and
   * the entry plays again. `sessionActive` is no boundary either: a conversation
   * keeps one session alive for hours, so the flag is already true on first
   * paint and never rises again. The browser half therefore plays this beat when
   * work RESUMES after the pet has rested for a while — one entry per burst.
   *
   * Played through the same track override as the feed reaction, so it survives
   * the phase changes that arrive while it runs and hands back to the phase map
   * when it settles.
   */
  workEntry?: PetGameplayFeedDef
  /**
   * A one-shot reaction played when the active session ends — the bookend to
   * workEntry. Omit it if the pet shows nothing special on shutdown.
   */
  workExit?: PetGameplayFeedDef
  /**
   * A one-shot reaction played when a turn ends ABNORMALLY (the `failed` phase:
   * an error, an interrupt, or the token budget running out) — the pet's "that
   * was cut short" beat, as opposed to workExit's tidy wrap-up.
   *
   * It hangs off the phase rather than a session edge for the same reason
   * workExit does, and is held through the override slot so the next turn's
   * phases cannot cut it off mid-animation.
   */
  workInterrupt?: PetGameplayFeedDef
  idleDirector?: {
    intervalMs: number
    maxMiss: number
    idleWeight: number
    acts: { track: string; weight: number; phrases?: string[] }[]
  }
  stats?: Record<string, PetGameplayStatDef>
  /** Click hit box inside the sprite box (fractions). */
  hitBox?: { x0: number; y0: number; x1: number; y1: number }
  touch?: {
    zones: PetGameplayTouchZone[]
    /** Plain-click effect while a touch animation holds (miku: mood +0..3). */
    clickBoost?: { stat: string; min: number; max: number }
  }
  work?: {
    state: string
    successState: string
    failState: string
    tickMs: number
    /** Hold time of the result track before the next round. */
    resultMs?: { success: number; fail: number }
    successProbability: number
    success?: { effects: PetGameplayEffect[] }
    fail?: { effects: PetGameplayEffect[] }
  }
  sleep?: {
    state: string
    wakeState?: string
    restore: { stat: string; amount: number; intervalMs: number }
  }
  /**
   * Extra named modes beyond work/sleep, keyed by a kebab mode id. Each one
   * gets its own menu button, holds its track while active and may restore a
   * stat on a cadence. 'work' and 'sleep' are reserved keys.
   */
  modes?: Record<string, PetGameplayModeDef>
  /**
   * Random roaming: on a slow interval the pet rolls whether to wander and
   * walks to a new spot on screen with `state` held for the travel time. The
   * chrome owns the motion (clamped to the viewport) and persists the resting
   * spot the way a drag does; the roll only runs while the pet is idle and no
   * mode, drag or touch animation owns it.
   */
  roam?: {
    /** frames2d track held while walking. */
    state: string
    /** Ms between roam decisions. */
    intervalMs: number
    /** Chance one decision actually walks (0, 1]. */
    probability: number
    /** Travel per roam in px (distanceMin <= distanceMax). */
    distanceMin: number
    distanceMax: number
    /** Walking speed in px per second. */
    speed: number
    /**
     * Directions the pet may walk in, rolled uniformly (equal chance each).
     * Omitted = all four. A side-view crawl reads best walking left/right, so
     * a pet may restrict the list to those two.
     */
    directions?: PetRoamDirection[]
  }
  passiveIncome?: { currency: string; amount: number; intervalMs: number }
  shop?: { state?: string; items: PetGameplayShopItem[] }
  /** Track played while the chrome reports dragging (default 'drag'). */
  dragState?: string
  /** Track played once when a drag ends (miku: standup), before settling. */
  dragEndState?: string
}

/* ------------------------------------------------------------------ *
 * Manifest parsing (fail-closed structure)
 * ------------------------------------------------------------------ */

const KEBAB = /^[a-z0-9][a-z0-9-]*$/
const MAX_STATS = 16
const MAX_ZONES = 8
const MAX_BRANCHES = 8
const MAX_ACTS = 16
const MAX_SHOP_ITEMS = 32
/** Tracks one shop item may roll from (a mystery box plays a random one). */
const MAX_REACTION_STATES = 8
const MAX_LOTTERY_TIERS = 16
const MAX_PHRASES = 64
const PHRASE_MAX_LENGTH = 120
const MAX_MODES = 8
const MODE_LABEL_MAX_LENGTH = 40
const STAT_VALUE_MAX = 1_000_000
const CURRENCY_MAX = 9_999_999

const KNOWN_GAMEPLAY = new Set(['idleDirector', 'stats', 'hitBox', 'touch', 'work', 'sleep', 'modes', 'roam', 'passiveIncome', 'shop', 'dragState', 'dragEndState', 'feed', 'blockPhases', 'workEntry', 'workExit', 'workInterrupt'])

/** Activity phases a gameplay block may lock itself out of (closed set). */
export const GAMEPLAY_BLOCKABLE_PHASES: readonly ActivityPhase[] = [
  'idle', 'waiting', 'thinking', 'tool', 'review', 'done', 'failed',
]
const KNOWN_FEED = new Set(['track', 'states', 'holdMs', 'effects', 'gapMs'])
const KNOWN_STAT = new Set(['max', 'initial', 'decayPerMinute', 'workingDecayPerMinute', 'idleDecayPerMinute', 'mirror', 'affinityFloorDivisor'])
const KNOWN_ZONE = new Set(['name', 'y0', 'y1', 'branches'])
const KNOWN_TOUCH = new Set(['zones', 'clickBoost'])
const KNOWN_BRANCH = new Set(['probability', 'effects', 'state', 'stateMs', 'phrases'])
const KNOWN_EFFECT = new Set(['stat', 'currency', 'amount'])
const KNOWN_WORK = new Set(['state', 'successState', 'failState', 'tickMs', 'resultMs', 'successProbability', 'success', 'fail'])
const KNOWN_SLEEP = new Set(['state', 'wakeState', 'restore'])
const KNOWN_MODE = new Set(['state', 'label', 'activeLabel', 'restore', 'once', 'holdMs'])
const KNOWN_ROAM = new Set(['state', 'intervalMs', 'probability', 'distanceMin', 'distanceMax', 'speed', 'directions'])
const KNOWN_RESTORE = new Set(['stat', 'amount', 'intervalMs'])
const KNOWN_SHOP_ITEM = new Set(['id', 'label', 'image', 'price', 'currency', 'effects', 'lottery'])
const KNOWN_LOTTERY = new Set(['effects', 'currency', 'tiers'])
const KNOWN_IDLE_DIRECTOR = new Set(['intervalMs', 'maxMiss', 'idleWeight', 'acts'])
const KNOWN_ACT = new Set(['track', 'weight', 'phrases'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unknownKeys(source: Record<string, unknown>, known: Set<string>): string[] {
  return Object.keys(source).filter(key => !known.has(key))
}

export interface GameplayParseHooks {
  /** State names the renderer can play (frames2d track ids). */
  stateNames: ReadonlySet<string>
  error: (message: string) => void
}

function validName(name: unknown, max = 32): name is string {
  return typeof name === 'string' && name.length <= max && KEBAB.test(name)
}

function intIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function numIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function parseEffects(raw: unknown, field: string, stats: Record<string, PetGameplayStatDef>, hooks: GameplayParseHooks): PetGameplayEffect[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length === 0) {
    hooks.error(field + ' must be a non-empty array of effects')
    return undefined
  }
  const effects: PetGameplayEffect[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) {
      hooks.error(field + ': every effect must be an object')
      continue
    }
    const extra = unknownKeys(entry, KNOWN_EFFECT)
    if (extra.length > 0) hooks.error(field + ': unknown effect field(s) ' + extra.map(k => JSON.stringify(k)).join(', '))
    const hasStat = typeof entry.stat === 'string'
    const hasCurrency = typeof entry.currency === 'string'
    if (hasStat === hasCurrency) {
      hooks.error(field + ': an effect needs exactly one of stat or currency')
      continue
    }
    if (!intIn(entry.amount, -STAT_VALUE_MAX, STAT_VALUE_MAX) || entry.amount === 0) {
      hooks.error(field + ': effect amount must be a non-zero integer within ±' + STAT_VALUE_MAX)
      continue
    }
    if (hasStat && stats[entry.stat as string] === undefined) {
      hooks.error(field + ': effect references undeclared stat ' + JSON.stringify(entry.stat))
      continue
    }
    if (hasCurrency && !validName(entry.currency, 24)) {
      hooks.error(field + ': effect currency must be a kebab id')
      continue
    }
    effects.push({
      ...(hasStat ? { stat: entry.stat as string } : {}),
      ...(hasCurrency ? { currency: entry.currency as string } : {}),
      amount: entry.amount as number,
    })
  }
  return effects.length === 0 ? undefined : effects
}

function parsePhrases(raw: unknown, field: string, hooks: GameplayParseHooks): string[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PHRASES
    || raw.some(line => typeof line !== 'string' || line.trim() === '' || line.length > PHRASE_MAX_LENGTH)) {
    hooks.error(field + ' must be 1..' + MAX_PHRASES + ' non-empty lines of at most ' + PHRASE_MAX_LENGTH + ' chars')
    return undefined
  }
  return raw as string[]
}

function parseStateRef(raw: unknown, field: string, hooks: GameplayParseHooks): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || !hooks.stateNames.has(raw)) {
    hooks.error(field + ' must name a declared frames2d track')
    return undefined
  }
  return raw
}

/** Parse one mode restore rule "{ stat (declared), amount, intervalMs }". */
function parseModeRestore(
  raw: unknown,
  field: string,
  stats: Record<string, PetGameplayStatDef>,
  fail: (message: string) => void,
): { stat: string; amount: number; intervalMs: number } | undefined {
  if (!isRecord(raw)) {
    fail(field + ' must be an object { stat, amount, intervalMs }')
    return undefined
  }
  const extra = unknownKeys(raw, KNOWN_RESTORE)
  if (extra.length > 0) fail(field + ': unknown field(s) ' + extra.map(k => JSON.stringify(k)).join(', '))
  const stat = typeof raw.stat === 'string' && stats[raw.stat] !== undefined ? raw.stat : undefined
  if (stat === undefined) fail(field + '.stat must reference a declared stat')
  if (!intIn(raw.amount, 1, 1000)) fail(field + '.amount must be an integer in [1, 1000]')
  if (!intIn(raw.intervalMs, 1000, 600_000)) fail(field + '.intervalMs must be an integer in [1000, 600000]')
  if (stat === undefined || !intIn(raw.amount, 1, 1000) || !intIn(raw.intervalMs, 1000, 600_000)) return undefined
  return { stat, amount: raw.amount, intervalMs: raw.intervalMs }
}

/**
 * Validate the manifest 'gameplay' block (fail-closed). Only frames2d pets
 * may declare gameplay today: every state reference checks against the
 * declared track names.
 */
export function parseGameplayManifest(raw: unknown, hooks: GameplayParseHooks): PetGameplayManifest | undefined {
  const error = (message: string): void => hooks.error(message)
  if (!isRecord(raw)) {
    error('gameplay must be an object')
    return undefined
  }
  const extra = unknownKeys(raw, KNOWN_GAMEPLAY)
  if (extra.length > 0) error('gameplay: unknown field(s) ' + extra.map(k => JSON.stringify(k)).join(', '))
  let failed = false
  const fail = (message: string): void => { failed = true; error(message) }

  // --- blockPhases (independent of every other field) ---
  let blockPhases: ActivityPhase[] | undefined
  if (raw.blockPhases !== undefined) {
    if (!Array.isArray(raw.blockPhases) || raw.blockPhases.length === 0) {
      fail('gameplay.blockPhases must be a non-empty array of activity phases')
    } else if (raw.blockPhases.length > GAMEPLAY_BLOCKABLE_PHASES.length) {
      fail('gameplay.blockPhases declares more phases than exist')
    } else {
      const kept: ActivityPhase[] = []
      for (const value of raw.blockPhases) {
        if (typeof value !== 'string' || !GAMEPLAY_BLOCKABLE_PHASES.includes(value as ActivityPhase)) {
          fail('gameplay.blockPhases: ' + JSON.stringify(value) + ' is not an activity phase ('
            + GAMEPLAY_BLOCKABLE_PHASES.join(', ') + ')')
          continue
        }
        // Idle is the resting state: locking it out would leave the player with
        // a panel that never works, so it is refused rather than silently
        // ignored as a harmless no-op.
        if (value === 'idle') {
          fail('gameplay.blockPhases must not contain "idle" (the pet would never accept an interaction)')
          continue
        }
        if (!kept.includes(value as ActivityPhase)) kept.push(value as ActivityPhase)
      }
      if (kept.length > 0) blockPhases = kept
    }
  }

  // --- stats (parsed first: effects reference them) ---
  const stats: Record<string, PetGameplayStatDef> = {}
  if (raw.stats !== undefined) {
    if (!isRecord(raw.stats)) fail('gameplay.stats must be an object keyed by stat id')
    else {
      const entries = Object.entries(raw.stats)
      if (entries.length > MAX_STATS) fail('gameplay.stats declares too many stats (max ' + MAX_STATS + ')')
      for (const [name, value] of entries) {
        if (!validName(name, 24)) {
          fail('gameplay.stats: invalid stat id ' + JSON.stringify(name))
          continue
        }
        if (!isRecord(value)) {
          fail('gameplay.stats.' + name + ' must be an object')
          continue
        }
        const statExtra = unknownKeys(value, KNOWN_STAT)
        if (statExtra.length > 0) fail('gameplay.stats.' + name + ': unknown field(s) ' + statExtra.map(k => JSON.stringify(k)).join(', '))
        if (!intIn(value.max, 1, STAT_VALUE_MAX)) {
          fail('gameplay.stats.' + name + '.max must be an integer in [1, ' + STAT_VALUE_MAX + ']')
          continue
        }
        const def: PetGameplayStatDef = { max: value.max }
        if (value.mirror !== undefined) {
          if (value.mirror !== 'affinity') fail('gameplay.stats.' + name + '.mirror must be "affinity"')
          else def.mirror = 'affinity'
        }
        if (value.affinityFloorDivisor !== undefined) {
          if (!numIn(value.affinityFloorDivisor, 1, 1000)) fail('gameplay.stats.' + name + '.affinityFloorDivisor must be a number in [1, 1000]')
          else if (def.mirror === undefined) def.affinityFloorDivisor = value.affinityFloorDivisor
        }
        if (value.initial !== undefined) {
          if (!numIn(value.initial, 0, value.max)) fail('gameplay.stats.' + name + '.initial must be within [0, max]')
          else def.initial = value.initial
        }
        for (const key of ['decayPerMinute', 'workingDecayPerMinute', 'idleDecayPerMinute'] as const) {
          if (value[key] !== undefined) {
            if (!numIn(value[key], 0, 1000)) fail('gameplay.stats.' + name + '.' + key + ' must be a number in [0, 1000]')
            else def[key] = value[key] as number
          }
        }
        stats[name] = def
      }
    }
  }

  const block: PetGameplayManifest = {}
  if (Object.keys(stats).length > 0) block.stats = stats

  // --- idle director ---
  if (raw.idleDirector !== undefined) {
    if (!isRecord(raw.idleDirector) || !Array.isArray(raw.idleDirector.acts)) {
      fail('gameplay.idleDirector must be an object with an acts array')
    } else {
      const d = raw.idleDirector as Record<string, unknown> & { acts: unknown[] }
      const dExtra = unknownKeys(d, KNOWN_IDLE_DIRECTOR)
      if (dExtra.length > 0) fail('gameplay.idleDirector: unknown field(s) ' + dExtra.map(k => JSON.stringify(k)).join(', '))
      if (d.intervalMs !== undefined && !intIn(d.intervalMs, 1000, 60_000)) fail('gameplay.idleDirector.intervalMs must be an integer in [1000, 60000]')
      if (d.maxMiss !== undefined && !intIn(d.maxMiss, 0, 10)) fail('gameplay.idleDirector.maxMiss must be an integer in [0, 10]')
      if (d.idleWeight !== undefined && !intIn(d.idleWeight, 0, 10_000)) fail('gameplay.idleDirector.idleWeight must be an integer in [0, 10000]')
      if (d.acts.length === 0 || d.acts.length > MAX_ACTS) fail('gameplay.idleDirector.acts must declare 1..' + MAX_ACTS + ' acts')
      const acts: { track: string; weight: number; phrases?: string[] }[] = []
      for (const act of d.acts as unknown[]) {
        if (!isRecord(act) || !intIn(act.weight, 1, 10_000)) {
          fail('gameplay.idleDirector.acts entries need a weight integer in [1, 10000]')
          continue
        }
        const aExtra = unknownKeys(act, KNOWN_ACT)
        if (aExtra.length > 0) fail('gameplay.idleDirector.acts: unknown field(s) ' + aExtra.map(k => JSON.stringify(k)).join(', '))
        const track = parseStateRef(act.track, 'gameplay.idleDirector.acts.track', hooks)
        if (track === undefined) continue
        const entry: { track: string; weight: number; phrases?: string[] } = { track, weight: act.weight }
        const phrases = parsePhrases(act.phrases, 'gameplay.idleDirector.acts.phrases', hooks)
        if (phrases !== undefined) entry.phrases = phrases
        acts.push(entry)
      }
      if (acts.length > 0) {
        block.idleDirector = {
          intervalMs: intIn(d.intervalMs, 1000, 60_000) ? d.intervalMs as number : 5000,
          maxMiss: intIn(d.maxMiss, 0, 10) ? d.maxMiss as number : 2,
          idleWeight: intIn(d.idleWeight, 0, 10_000) ? d.idleWeight as number : 0,
          acts,
        }
      }
    }
  }

  // --- hit box ---
  if (raw.hitBox !== undefined) {
    const b = raw.hitBox
    if (!isRecord(b) || !numIn(b.x0, 0, 1) || !numIn(b.x1, 0, 1) || !numIn(b.y0, 0, 1) || !numIn(b.y1, 0, 1)
      || !(b.x0 < b.x1) || !(b.y0 < b.y1)) {
      fail('gameplay.hitBox must be { x0, y0, x1, y1 } fractions with x0 < x1 and y0 < y1')
    } else {
      block.hitBox = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }
    }
  }

  // --- touch zones ---
  if (raw.touch !== undefined) {
    if (!isRecord(raw.touch) || !Array.isArray(raw.touch.zones)) {
      fail('gameplay.touch must be an object with a zones array')
    } else {
      const tExtra = unknownKeys(raw.touch, KNOWN_TOUCH)
      if (tExtra.length > 0) fail('gameplay.touch: unknown field(s) ' + tExtra.map(k => JSON.stringify(k)).join(', '))
      let clickBoost: { stat: string; min: number; max: number } | undefined
      if (raw.touch.clickBoost !== undefined) {
        const cb = raw.touch.clickBoost
        if (!isRecord(cb) || typeof cb.stat !== 'string' || stats[cb.stat] === undefined
          || !intIn(cb.min, 0, 1000) || !intIn(cb.max, 0, 1000) || (cb.min as number) > (cb.max as number)) {
          fail('gameplay.touch.clickBoost must be { stat (declared), min, max } integers with 0 <= min <= max <= 1000')
        } else clickBoost = { stat: cb.stat, min: cb.min, max: cb.max }
      }
      const zones: PetGameplayTouchZone[] = []
      if (raw.touch.zones.length === 0 || raw.touch.zones.length > MAX_ZONES) fail('gameplay.touch.zones must declare 1..' + MAX_ZONES + ' zones')
      for (const zoneRaw of raw.touch.zones as unknown[]) {
        if (!isRecord(zoneRaw) || !validName(zoneRaw.name) || !numIn(zoneRaw.y0, 0, 1) || !numIn(zoneRaw.y1, 0, 1) || !(zoneRaw.y0 < zoneRaw.y1)) {
          fail('gameplay.touch.zones entries need a kebab name and 0 <= y0 < y1 <= 1')
          continue
        }
        const zExtra = unknownKeys(zoneRaw, KNOWN_ZONE)
        if (zExtra.length > 0) fail('gameplay.touch.' + zoneRaw.name + ': unknown field(s) ' + zExtra.map(k => JSON.stringify(k)).join(', '))
        if (!Array.isArray(zoneRaw.branches) || zoneRaw.branches.length === 0 || zoneRaw.branches.length > MAX_BRANCHES) {
          fail('gameplay.touch.' + zoneRaw.name + '.branches must declare 1..' + MAX_BRANCHES + ' branches')
          continue
        }
        let probabilitySum = 0
        const branches: PetGameplayTouchBranch[] = []
        for (const branchRaw of zoneRaw.branches as unknown[]) {
          if (!isRecord(branchRaw) || !numIn(branchRaw.probability, 0, 1) || branchRaw.probability === 0) {
            fail('gameplay.touch.' + zoneRaw.name + '.branches entries need a probability in (0, 1]')
            continue
          }
          const bExtra = unknownKeys(branchRaw, KNOWN_BRANCH)
          if (bExtra.length > 0) fail('gameplay.touch.' + zoneRaw.name + ': unknown branch field(s) ' + bExtra.map(k => JSON.stringify(k)).join(', '))
          probabilitySum += branchRaw.probability
          const branch: PetGameplayTouchBranch = { probability: branchRaw.probability }
          const effects = parseEffects(branchRaw.effects, 'gameplay.touch.' + zoneRaw.name + '.effects', stats, hooks)
          if (effects !== undefined) branch.effects = effects
          const state = parseStateRef(branchRaw.state, 'gameplay.touch.' + zoneRaw.name + '.state', hooks)
          if (state !== undefined) branch.state = state
          if (branchRaw.stateMs !== undefined) {
            if (!intIn(branchRaw.stateMs, 200, 10_000)) fail('gameplay.touch.' + zoneRaw.name + '.stateMs must be an integer in [200, 10000]')
            else branch.stateMs = branchRaw.stateMs
          }
          const phrases = parsePhrases(branchRaw.phrases, 'gameplay.touch.' + zoneRaw.name + '.phrases', hooks)
          if (phrases !== undefined) branch.phrases = phrases
          branches.push(branch)
        }
        if (probabilitySum > 1 + 1e-9) fail('gameplay.touch.' + zoneRaw.name + ': branch probabilities must sum to at most 1')
        if (branches.length > 0) zones.push({ name: zoneRaw.name, y0: zoneRaw.y0, y1: zoneRaw.y1, branches })
      }
      if (zones.length > 0 || clickBoost !== undefined) block.touch = { zones, ...(clickBoost === undefined ? {} : { clickBoost }) }
    }
  }

  // --- work ---
  if (raw.work !== undefined) {
    const w = raw.work
    if (!isRecord(w)) fail('gameplay.work must be an object')
    else {
      const wExtra = unknownKeys(w, KNOWN_WORK)
      if (wExtra.length > 0) fail('gameplay.work: unknown field(s) ' + wExtra.map(k => JSON.stringify(k)).join(', '))
      const state = parseStateRef(w.state, 'gameplay.work.state', hooks)
      const successState = parseStateRef(w.successState, 'gameplay.work.successState', hooks)
      const failState = parseStateRef(w.failState, 'gameplay.work.failState', hooks)
      if (!intIn(w.tickMs, 1000, 60_000)) fail('gameplay.work.tickMs must be an integer in [1000, 60000]')
      if (!numIn(w.successProbability, 0, 1)) fail('gameplay.work.successProbability must be a number in [0, 1]')
      if (state !== undefined && successState !== undefined && failState !== undefined
        && intIn(w.tickMs, 1000, 60_000) && numIn(w.successProbability, 0, 1)) {
        const work: NonNullable<PetGameplayManifest['work']> = {
          state, successState, failState,
          tickMs: w.tickMs,
          successProbability: w.successProbability,
        }
        if (w.resultMs !== undefined) {
          if (!isRecord(w.resultMs) || !intIn(w.resultMs.success, 200, 10_000) || !intIn(w.resultMs.fail, 200, 10_000)) {
            fail('gameplay.work.resultMs must be { success, fail } integers in [200, 10000]')
          } else work.resultMs = { success: w.resultMs.success, fail: w.resultMs.fail }
        }
        for (const key of ['success', 'fail'] as const) {
          if (w[key] !== undefined) {
            if (!isRecord(w[key])) fail('gameplay.work.' + key + ' must be an object { effects }')
            else {
              const effects = parseEffects((w[key] as Record<string, unknown>).effects, 'gameplay.work.' + key + '.effects', stats, hooks)
              if (effects !== undefined) work[key] = { effects }
            }
          }
        }
        block.work = work
      }
    }
  }

  // --- sleep ---
  if (raw.sleep !== undefined) {
    const s = raw.sleep
    if (!isRecord(s) || !isRecord(s.restore)) fail('gameplay.sleep must be an object with a restore block')
    else {
      const sExtra = unknownKeys(s, KNOWN_SLEEP)
      if (sExtra.length > 0) fail('gameplay.sleep: unknown field(s) ' + sExtra.map(k => JSON.stringify(k)).join(', '))
      const state = parseStateRef(s.state, 'gameplay.sleep.state', hooks)
      const wakeState = parseStateRef(s.wakeState, 'gameplay.sleep.wakeState', hooks)
      const restore = parseModeRestore(s.restore, 'gameplay.sleep.restore', stats, fail)
      if (state !== undefined && restore !== undefined) {
        block.sleep = {
          state,
          ...(wakeState === undefined ? {} : { wakeState }),
          restore,
        }
      }
    }
  }

  // --- extra modes (bath and friends) ---
  if (raw.modes !== undefined) {
    if (!isRecord(raw.modes)) fail('gameplay.modes must be an object keyed by mode id')
    else {
      const entries = Object.entries(raw.modes)
      if (entries.length > MAX_MODES) fail('gameplay.modes declares too many modes (max ' + MAX_MODES + ')')
      const modes: Record<string, PetGameplayModeDef> = {}
      for (const [name, value] of entries) {
        if (!validName(name, 24) || name === 'work' || name === 'sleep') {
          fail('gameplay.modes: invalid mode id ' + JSON.stringify(name) + ' (kebab, and not the reserved work/sleep)')
          continue
        }
        if (!isRecord(value)) {
          fail('gameplay.modes.' + name + ' must be an object')
          continue
        }
        const mExtra = unknownKeys(value, KNOWN_MODE)
        if (mExtra.length > 0) fail('gameplay.modes.' + name + ': unknown field(s) ' + mExtra.map(k => JSON.stringify(k)).join(', '))
        const state = parseStateRef(value.state, 'gameplay.modes.' + name + '.state', hooks)
        let usable = state !== undefined
        let label: string | undefined
        if (value.label !== undefined) {
          if (typeof value.label !== 'string' || value.label.trim() === '' || value.label.length > MODE_LABEL_MAX_LENGTH) {
            fail('gameplay.modes.' + name + '.label must be a non-empty string of at most ' + MODE_LABEL_MAX_LENGTH + ' chars')
            usable = false
          } else label = value.label.trim()
        }
        let activeLabel: string | undefined
        if (value.activeLabel !== undefined) {
          if (typeof value.activeLabel !== 'string' || value.activeLabel.trim() === '' || value.activeLabel.length > MODE_LABEL_MAX_LENGTH) {
            fail('gameplay.modes.' + name + '.activeLabel must be a non-empty string of at most ' + MODE_LABEL_MAX_LENGTH + ' chars')
            usable = false
          } else activeLabel = value.activeLabel.trim()
        }
        const restore = value.restore === undefined ? undefined : parseModeRestore(value.restore, 'gameplay.modes.' + name + '.restore', stats, fail)
        if (value.restore !== undefined && restore === undefined) usable = false
        let once: boolean | undefined
        if (value.once !== undefined) {
          if (typeof value.once !== 'boolean') {
            fail('gameplay.modes.' + name + '.once must be a boolean')
            usable = false
          } else if (value.once) once = true
        }
        let holdMs: number | undefined
        if (value.holdMs !== undefined) {
          if (!intIn(value.holdMs, 500, 10_000)) {
            fail('gameplay.modes.' + name + '.holdMs must be an integer in [500, 10000]')
            usable = false
          } else holdMs = value.holdMs
        }
        // A one-shot mode is played and settled by the browser half, so a
        // restore cadence can never fire; refuse the contradiction rather than
        // silently dropping the restore the manifest asked for.
        if (once === true && restore !== undefined) {
          fail('gameplay.modes.' + name + ': a once mode cannot declare restore')
          usable = false
        }
        if (usable && state !== undefined) {
          modes[name] = {
            state,
            ...(label === undefined ? {} : { label }),
            ...(activeLabel === undefined ? {} : { activeLabel }),
            ...(restore === undefined ? {} : { restore }),
            ...(once === undefined ? {} : { once }),
            ...(holdMs === undefined ? {} : { holdMs }),
          }
        }
      }
      if (Object.keys(modes).length > 0) block.modes = modes
    }
  }

  // --- random roaming ---
  if (raw.roam !== undefined) {
    const rm = raw.roam
    if (!isRecord(rm)) fail('gameplay.roam must be an object')
    else {
      const rExtra = unknownKeys(rm, KNOWN_ROAM)
      if (rExtra.length > 0) fail('gameplay.roam: unknown field(s) ' + rExtra.map(k => JSON.stringify(k)).join(', '))
      const state = parseStateRef(rm.state, 'gameplay.roam.state', hooks)
      if (!intIn(rm.intervalMs, 1000, 3_600_000)) fail('gameplay.roam.intervalMs must be an integer in [1000, 3600000]')
      if (!numIn(rm.probability, 0, 1) || rm.probability === 0) fail('gameplay.roam.probability must be a number in (0, 1]')
      if (!intIn(rm.distanceMin, 1, 2000)) fail('gameplay.roam.distanceMin must be an integer in [1, 2000]')
      if (!intIn(rm.distanceMax, 1, 2000)) fail('gameplay.roam.distanceMax must be an integer in [1, 2000]')
      if (intIn(rm.distanceMin, 1, 2000) && intIn(rm.distanceMax, 1, 2000) && rm.distanceMin > rm.distanceMax) {
        fail('gameplay.roam.distanceMin must not exceed distanceMax')
      }
      if (!intIn(rm.speed, 1, 2000)) fail('gameplay.roam.speed must be an integer in [1, 2000] (px per second)')
      let directions: PetRoamDirection[] | undefined
      if (rm.directions !== undefined) {
        if (!Array.isArray(rm.directions) || rm.directions.length === 0) {
          fail('gameplay.roam.directions must be a non-empty array of up, down, left, right')
        } else {
          const picked: PetRoamDirection[] = []
          for (const entry of rm.directions as unknown[]) {
            if (typeof entry !== 'string' || !PET_ROAM_DIRECTIONS.includes(entry as PetRoamDirection)) {
              fail('gameplay.roam.directions entries must be up, down, left or right')
              picked.length = 0
              break
            }
            if (picked.includes(entry as PetRoamDirection)) {
              fail('gameplay.roam.directions must not repeat ' + entry)
              picked.length = 0
              break
            }
            picked.push(entry as PetRoamDirection)
          }
          if (picked.length > 0) directions = picked
        }
      }
      // The guards are repeated inline: tsc only narrows the unknown fields
      // through a call in the condition itself.
      if (state !== undefined
        && intIn(rm.intervalMs, 1000, 3_600_000)
        && numIn(rm.probability, 0, 1) && rm.probability !== 0
        && intIn(rm.distanceMin, 1, 2000)
        && intIn(rm.distanceMax, 1, 2000)
        && rm.distanceMin <= rm.distanceMax
        && intIn(rm.speed, 1, 2000)) {
        block.roam = {
          state,
          intervalMs: rm.intervalMs,
          probability: rm.probability,
          distanceMin: rm.distanceMin,
          distanceMax: rm.distanceMax,
          speed: rm.speed,
          ...(directions === undefined ? {} : { directions }),
        }
      }
    }
  }

  // --- passive income ---
  if (raw.passiveIncome !== undefined) {
    const p = raw.passiveIncome
    if (!isRecord(p) || !validName(p.currency, 24) || !intIn(p.amount, 1, 10_000) || !intIn(p.intervalMs, 1000, 86_400_000)) {
      fail('gameplay.passiveIncome must be { currency (kebab), amount 1..10000, intervalMs 1000..86400000 }')
    } else {
      block.passiveIncome = { currency: p.currency, amount: p.amount, intervalMs: p.intervalMs }
    }
  }

  // --- shop ---
  if (raw.shop !== undefined) {
    const s = raw.shop
    if (!isRecord(s) || !Array.isArray(s.items) || s.items.length === 0 || s.items.length > MAX_SHOP_ITEMS) {
      fail('gameplay.shop must be an object with 1..' + MAX_SHOP_ITEMS + ' items')
    } else {
      const shopState = parseStateRef(s.state, 'gameplay.shop.state', hooks)
      const items: PetGameplayShopItem[] = []
      const seen = new Set<string>()
      for (const itemRaw of s.items as unknown[]) {
        if (!isRecord(itemRaw) || !validName(itemRaw.id, 24)) {
          fail('gameplay.shop.items entries need a kebab id')
          continue
        }
        if (seen.has(itemRaw.id)) {
          fail('gameplay.shop: duplicate item id ' + JSON.stringify(itemRaw.id))
          continue
        }
        seen.add(itemRaw.id)
        const iExtra = unknownKeys(itemRaw, KNOWN_SHOP_ITEM)
        if (iExtra.length > 0) fail('gameplay.shop.' + itemRaw.id + ': unknown field(s) ' + iExtra.map(k => JSON.stringify(k)).join(', '))
        if (typeof itemRaw.label !== 'string' || itemRaw.label.trim() === '' || itemRaw.label.length > 80) {
          fail('gameplay.shop.' + itemRaw.id + '.label must be a non-empty string of at most 80 chars')
          continue
        }
        if (!intIn(itemRaw.price, 1, 1_000_000)) {
          fail('gameplay.shop.' + itemRaw.id + '.price must be an integer in [1, 1000000]')
          continue
        }
        if (!validName(itemRaw.currency, 24)) {
          fail('gameplay.shop.' + itemRaw.id + '.currency must be a kebab id')
          continue
        }
        const item: PetGameplayShopItem = {
          id: itemRaw.id,
          label: itemRaw.label.trim(),
          price: itemRaw.price,
          currency: itemRaw.currency,
        }
        if (itemRaw.image !== undefined) {
          if (typeof itemRaw.image !== 'string' || itemRaw.image.includes('..') || itemRaw.image.includes('\\') || itemRaw.image.startsWith('/')) {
            fail('gameplay.shop.' + itemRaw.id + '.image must be a safe manifest-relative frame path')
          } else item.image = itemRaw.image
        }
        const effects = parseEffects(itemRaw.effects, 'gameplay.shop.' + itemRaw.id + '.effects', stats, hooks)
        if (effects !== undefined) item.effects = effects
        if (itemRaw.lottery !== undefined) {
          const l = itemRaw.lottery
          if (!isRecord(l) || !Array.isArray(l.tiers) || l.tiers.length === 0 || l.tiers.length > MAX_LOTTERY_TIERS) {
            fail('gameplay.shop.' + itemRaw.id + '.lottery needs 1..' + MAX_LOTTERY_TIERS + ' tiers')
          } else {
            const lExtra = unknownKeys(l, KNOWN_LOTTERY)
            if (lExtra.length > 0) fail('gameplay.shop.' + itemRaw.id + '.lottery: unknown field(s) ' + lExtra.map(k => JSON.stringify(k)).join(', '))
            if (l.currency !== undefined && !validName(l.currency, 24)) fail('gameplay.shop.' + itemRaw.id + '.lottery.currency must be a kebab id')
            let tierSum = 0
            const tiers: { probability: number; prize: number; currency?: string }[] = []
            for (const tierRaw of l.tiers as unknown[]) {
              if (!isRecord(tierRaw) || !numIn(tierRaw.probability, 0, 1) || tierRaw.probability === 0
                || !intIn(tierRaw.prize, 0, 1_000_000_000)) {
                fail('gameplay.shop.' + itemRaw.id + '.lottery.tiers entries need probability (0,1] and prize 0..1e9')
                continue
              }
              tierSum += tierRaw.probability
              const tier: { probability: number; prize: number; currency?: string } = {
                probability: tierRaw.probability,
                prize: tierRaw.prize,
              }
              if (tierRaw.currency !== undefined) {
                if (!validName(tierRaw.currency, 24)) fail('gameplay.shop.' + itemRaw.id + '.lottery tier currency must be a kebab id')
                else tier.currency = tierRaw.currency
              }
              tiers.push(tier)
            }
            if (tierSum > 1 + 1e-9) fail('gameplay.shop.' + itemRaw.id + '.lottery tier probabilities must sum to at most 1')
            if (tiers.length > 0) {
              const lotteryEffects = parseEffects(l.effects, 'gameplay.shop.' + itemRaw.id + '.lottery.effects', stats, hooks)
              item.lottery = {
                tiers,
                ...(lotteryEffects === undefined ? {} : { effects: lotteryEffects }),
                ...(validName(l.currency, 24) ? { currency: l.currency } : {}),
              }
            }
          }
        }
        // A purchase needs *something* to do: stats or a prize.
        if (item.effects === undefined && item.lottery === undefined) {
          fail('gameplay.shop.' + itemRaw.id + ' needs effects or a lottery')
          continue
        }
        items.push(item)
      }
      if (items.length > 0) block.shop = { ...(shopState === undefined ? {} : { state: shopState }), items }
    }
  }

  // --- drag state ---
  if (raw.dragState !== undefined) {
    const state = parseStateRef(raw.dragState, 'gameplay.dragState', hooks)
    if (state !== undefined) block.dragState = state
  }
  if (raw.dragEndState !== undefined) {
    const state = parseStateRef(raw.dragEndState, 'gameplay.dragEndState', hooks)
    if (state !== undefined) block.dragEndState = state
  }

  // --- one-shot reaction blocks: the panel feed button, and the session
  // --- start/end beats. Same shape, so they share one parser.
  const parseReaction = (field: 'feed' | 'workEntry' | 'workExit' | 'workInterrupt', rawValue: unknown): PetGameplayFeedDef | undefined => {
    if (!isRecord(rawValue)) {
      fail('gameplay.' + field + ' must be an object { track | states, holdMs? }')
      return undefined
    }
    const extra = unknownKeys(rawValue, KNOWN_FEED)
    if (extra.length > 0) fail('gameplay.' + field + ': unknown field(s) ' + extra.map(k => JSON.stringify(k)).join(', '))
    const def: PetGameplayFeedDef = {}
    // `track` stays the shorthand for a single reaction; `states` is the pool.
    // A pool wins when both are present, mirroring a shop item's state/states.
    if (rawValue.track !== undefined) {
      const track = parseStateRef(rawValue.track, 'gameplay.' + field + '.track', hooks)
      if (track !== undefined) def.track = track
    }
    if (rawValue.states !== undefined) {
      if (!Array.isArray(rawValue.states) || rawValue.states.length === 0 || rawValue.states.length > MAX_REACTION_STATES) {
        fail('gameplay.' + field + '.states must be an array of 1..' + MAX_REACTION_STATES + ' tracks')
      } else {
        const pool: string[] = []
        for (const [index, entry] of (rawValue.states as unknown[]).entries()) {
          const track = parseStateRef(entry, 'gameplay.' + field + '.states[' + index + ']', hooks)
          if (track !== undefined) pool.push(track)
        }
        if (pool.length > 0) def.states = pool
      }
    }
    if (def.track === undefined && def.states === undefined) {
      if (rawValue.track === undefined && rawValue.states === undefined) {
        fail('gameplay.' + field + ' needs a "track" or a "states" pool')
      }
      return undefined
    }
    if (rawValue.holdMs !== undefined) {
      if (!intIn(rawValue.holdMs, 500, 10_000)) fail('gameplay.' + field + '.holdMs must be an integer in [500, 10000]')
      else def.holdMs = rawValue.holdMs
    }
    if (rawValue.effects !== undefined) {
      const effects = parseEffects(rawValue.effects, 'gameplay.' + field + '.effects', stats, hooks)
      if (effects !== undefined) def.effects = effects
    }
    if (rawValue.gapMs !== undefined) {
      if (!intIn(rawValue.gapMs, 0, 3_600_000)) fail('gameplay.' + field + '.gapMs must be an integer in [0, 3600000]')
      else def.gapMs = rawValue.gapMs
    }
    return def
  }
  if (raw.feed !== undefined) {
    const def = parseReaction('feed', raw.feed)
    if (def !== undefined) block.feed = def
  }
  if (raw.workEntry !== undefined) {
    const def = parseReaction('workEntry', raw.workEntry)
    if (def !== undefined) block.workEntry = def
  }
  if (raw.workExit !== undefined) {
    const def = parseReaction('workExit', raw.workExit)
    if (def !== undefined) block.workExit = def
  }
  if (raw.workInterrupt !== undefined) {
    const def = parseReaction('workInterrupt', raw.workInterrupt)
    if (def !== undefined) block.workInterrupt = def
  }

  if (blockPhases !== undefined) block.blockPhases = blockPhases
  return failed ? undefined : block
}

/* ------------------------------------------------------------------ *
 * Host engine (pure; clock and rng injected)
 * ------------------------------------------------------------------ */

/** Persisted per-pet gameplay state (pet.json 'gameplay' map values). */
export interface PetGameplayState {
  stats: Record<string, number>
  currencies: Record<string, number>
  /** Active gameplay mode id ('work' | 'sleep' | a declared extra mode) or null. */
  mode: string | null
  /** Epoch ms of the last lazy settle. */
  settledAt: number
  /** Accumulated remainder ms towards the next passive income tick. */
  incomeCarryMs?: number
  /** Accumulated remainder ms towards the next mode restore tick. */
  restoreCarryMs?: number
}

/**
 * One declared extra mode, by OWN key only. A plain `modes[id]` lookup also
 * answers for Object.prototype members ('constructor', 'toString', …), which
 * would let a crafted mode id pass the "is it declared?" test.
 */
function declaredModeOf(manifest: PetGameplayManifest, mode: string): PetGameplayModeDef | undefined {
  const modes = manifest.modes
  if (modes === undefined || !Object.prototype.hasOwnProperty.call(modes, mode)) return undefined
  return modes[mode]
}

/** Every mode the menu offers, in manifest order (sleep first, then extras). */
export function declaredModes(manifest: PetGameplayManifest): string[] {
  return [
    ...(manifest.sleep === undefined ? [] : ['sleep']),
    ...Object.keys(manifest.modes ?? {}),
  ]
}

/**
 * The frames2d track one active mode holds. 'work' is owned by the work loop
 * (its state, result and fallback are its own), so it resolves to undefined.
 */
export function modeStateOf(manifest: PetGameplayManifest, mode: string): string | undefined {
  if (mode === 'sleep') return manifest.sleep?.state
  if (mode === 'work') return manifest.work?.state
  return declaredModeOf(manifest, mode)?.state
}

/** The restore rule of one active mode, when it declares one. */
export function modeRestoreOf(
  manifest: PetGameplayManifest,
  mode: string | null,
): { stat: string; amount: number; intervalMs: number } | undefined {
  if (mode === null) return undefined
  if (mode === 'sleep') return manifest.sleep?.restore
  if (mode === 'work') return undefined
  // A one-shot mode never becomes active host-side, so it can never restore.
  const declared = declaredModeOf(manifest, mode)
  if (declared?.once === true) return undefined
  return declared?.restore
}

/**
 * Whether a menu mode runs its track once instead of holding it. One-shot
 * modes are presentation only: the browser half plays `state` and settles, and
 * no mode is entered — so the pet stays pettable and needs no exit click.
 */
export function isOneShotMode(manifest: PetGameplayManifest, mode: string): boolean {
  if (mode === 'work' || mode === 'sleep') return false
  return declaredModeOf(manifest, mode)?.once === true
}

/** The hold time a one-shot mode asks for, when it declares one. */
export function oneShotHoldMsOf(manifest: PetGameplayManifest, mode: string): number | undefined {
  if (!isOneShotMode(manifest, mode)) return undefined
  return declaredModeOf(manifest, mode)?.holdMs
}

/** Whether the manifest still declares this gameplay mode id. */
export function isDeclaredMode(manifest: PetGameplayManifest, mode: string): boolean {
  if (mode === 'work') return manifest.work !== undefined
  if (mode === 'sleep') return manifest.sleep !== undefined
  return declaredModeOf(manifest, mode) !== undefined
}

/** Fresh state for one pet: stats at their initial (default max), no currency. */
export function initialGameplayState(manifest: PetGameplayManifest, now: number): PetGameplayState {
  const stats: Record<string, number> = {}
  for (const [name, def] of Object.entries(manifest.stats ?? {})) {
    stats[name] = def.initial ?? def.max
  }
  return { stats, currencies: {}, mode: null, settledAt: now }
}

/** Clamp one stat value into [0, max]; currencies into [0, CURRENCY_MAX]. */
export function clampGameplay(state: PetGameplayState, manifest: PetGameplayManifest): void {
  for (const [name, def] of Object.entries(manifest.stats ?? {})) {
    const value = state.stats[name]
    if (value === undefined) state.stats[name] = def.initial ?? def.max
    else state.stats[name] = Math.min(def.max, Math.max(0, value))
  }
  for (const [name, value] of Object.entries(state.currencies)) {
    state.currencies[name] = Math.min(CURRENCY_MAX, Math.max(0, Math.floor(value)))
  }
}

/**
 * Lazy settle: apply stat decay, passive income and the active mode's restore
 * rule (sleep restores energy, a declared extra mode restores whatever it
 * declares) for the elapsed wall time since the last settle. Mirrors the
 * treats.ts discipline (no host timers; read paths settle). Returns whether
 * anything changed.
 */
export function settleGameplay(
  state: PetGameplayState,
  manifest: PetGameplayManifest,
  now: number,
  options: { sessionActive: boolean; affinityPoints?: number },
): boolean {
  const elapsedMs = now - state.settledAt
  if (elapsedMs <= 0) return false
  const minutes = elapsedMs / 60_000
  let changed = false
  for (const [name, def] of Object.entries(manifest.stats ?? {})) {
    const current = state.stats[name]
    if (current === undefined || current <= 0) continue
    let rate = def.decayPerMinute ?? 0
    if (state.mode === 'work' && def.workingDecayPerMinute !== undefined) rate = def.workingDecayPerMinute
    if (!options.sessionActive) rate += def.idleDecayPerMinute ?? 0
    if (rate <= 0) continue
    const next = Math.max(0, current - rate * minutes)
    if (next !== current) {
      state.stats[name] = next
      changed = true
    }
  }
  if (manifest.passiveIncome !== undefined) {
    const incomeElapsed = elapsedMs + (state.incomeCarryMs ?? 0)
    const interval = manifest.passiveIncome.intervalMs
    const ticks = Math.floor(incomeElapsed / interval)
    state.incomeCarryMs = incomeElapsed % interval
    if (ticks > 0) {
      const currency = manifest.passiveIncome.currency
      state.currencies[currency] = (state.currencies[currency] ?? 0) + ticks * manifest.passiveIncome.amount
      changed = true
    }
  }
  const restore = modeRestoreOf(manifest, state.mode)
  if (restore !== undefined) {
    const restoreElapsed = elapsedMs + (state.restoreCarryMs ?? 0)
    const interval = restore.intervalMs
    const ticks = Math.floor(restoreElapsed / interval)
    state.restoreCarryMs = restoreElapsed % interval
    if (ticks > 0) {
      state.stats[restore.stat] = (state.stats[restore.stat] ?? 0) + ticks * restore.amount
      changed = true
    }
  } else {
    state.restoreCarryMs = 0
  }
  state.settledAt = now
  clampGameplay(state, manifest)
  // Affection floor: the affinity ledger is the player's permanent progress, and
  // a pet whose affection decays to zero while the panel reads "822 点很久的
  // 亲密度" is the one thing that makes the two numbers feel unrelated. Declaring
  // `affinityFloorDivisor: 10` keeps the bar at least points/10 (capped at max),
  // so a long relationship can be neglected without ever being erased.
  if (options.affinityPoints !== undefined) {
    for (const [name, def] of Object.entries(manifest.stats ?? {})) {
      if (def.affinityFloorDivisor === undefined) continue
      const floor = Math.min(def.max, options.affinityPoints / def.affinityFloorDivisor)
      const current = state.stats[name]
      if (current === undefined) continue
      if (current < floor) {
        state.stats[name] = floor
        changed = true
      }
    }
  }
  return changed
}

/** Apply one effect vector (touch/work/shop), clamped. */
export function applyGameplayEffects(state: PetGameplayState, manifest: PetGameplayManifest, effects: readonly PetGameplayEffect[]): void {
  for (const effect of effects) {
    if (effect.stat !== undefined) {
      state.stats[effect.stat] = (state.stats[effect.stat] ?? 0) + effect.amount
    } else if (effect.currency !== undefined) {
      state.currencies[effect.currency] = (state.currencies[effect.currency] ?? 0) + effect.amount
    }
  }
  clampGameplay(state, manifest)
}

/**
 * The track one landed interaction plays: the `states` pool when declared, else
 * the single `track`. The roll is injected so callers stay deterministic in
 * tests, and the odds are the pool's own frequencies — repeat an entry to make
 * it more likely.
 */
export function pickFeedTrack(
  def: PetGameplayFeedDef | undefined,
  random: () => number = Math.random,
): string | undefined {
  if (def === undefined) return undefined
  const pool = def.states ?? (def.track === undefined ? [] : [def.track])
  if (pool.length === 0) return undefined
  if (pool.length === 1) return pool[0]
  // Clamp: a random() of exactly 1 (or a misbehaving injected roll) must not
  // index past the end.
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))
  return pool[index]
}

/** Roll one touch zone branch; undefined when the roll lands in no-op mass. */
export function rollTouchBranch(zone: PetGameplayTouchZone, rng: () => number): PetGameplayTouchBranch | undefined {
  const roll = rng()
  let acc = 0
  for (const branch of zone.branches) {
    acc += branch.probability
    if (roll < acc) return branch
  }
  return undefined
}

/** Roll one work tick outcome. */
export function rollWorkOutcome(work: NonNullable<PetGameplayManifest['work']>, rng: () => number): 'success' | 'fail' {
  return rng() < work.successProbability ? 'success' : 'fail'
}

/** Draw one lottery prize tier; uncovered mass falls through to the last tier. */
export function drawLotteryTier(
  lottery: NonNullable<PetGameplayShopItem['lottery']>,
  rng: () => number,
): { probability: number; prize: number; currency?: string } {
  const roll = rng()
  let acc = 0
  for (const tier of lottery.tiers) {
    acc += tier.probability
    if (roll < acc) return tier
  }
  return lottery.tiers[lottery.tiers.length - 1]!
}

/** The zone one normalized hit-box point lands in, if any. */
export function touchZoneAt(touch: { zones: PetGameplayTouchZone[] }, yFraction: number): PetGameplayTouchZone | undefined {
  return touch.zones.find(zone => yFraction >= zone.y0 && yFraction < zone.y1)
}
