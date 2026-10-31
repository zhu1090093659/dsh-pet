/**
 * Voice-pack normalization and merge (pet-center M4, issue #677).
 *
 * A voice pack is the optional 'voice.json' inside a pet directory, or the
 * global '$DSH_HOME/pets/.voice.json' override file — pure JSON content that
 * layers pet copy over the built-in pools. Two halves:
 *
 *  - 'overrides': the chatter pools (status / tools / toolRemaining /
 *    whispers) handed to the chatter engines through a VoicePoolsProvider;
 *  - 'panel': the hover-panel chrome (button labels, stat formats, action
 *    subset) served to the browser half through PetDefinition.panel.
 *
 * Discipline split matches the registry: STRUCTURE is fail-closed per file
 * (a non-object root drops the whole pack with a warning), CONTENT is
 * warn-and-drop per slot — one bad line never breaks a pet. The JSON Schema
 * twin lives at contracts/voice-pack-v1.schema.json for documentation and
 * external tooling; this hand-rolled normalizer is authoritative (the
 * repository ships no schema-validator runtime).
 *
 * Placeholder policy (each pool kind whitelists its own tokens):
 *  - status / whisper pools / panel labels: no placeholders allowed — a line
 *    carrying any '{...}' token is dropped with a warning;
 *  - tools: {tool} and {hint}; toolRemaining: {n}; panel stats:
 *    {rank} / {n} / {points}.
 *
 * This file is imported directly by scripts/dsh-pet under node's strip-only
 * TypeScript mode: keep it erasable-syntax-only.
 * @module @linxin666/dsh-pet/voice-pack
 */

import {
  STATUS_SCENES,
  TOOL_CATEGORIES,
  WHISPER_CATEGORIES,
  WHISPER_RESULTS,
  type VoicePackOverrides,
  type WhisperCategory,
  type WhisperResult,
} from './chatter.ts'
import { normalizePetRemarks, type PetRemarks } from './remarks.ts'
import type { AffinityRankName } from './affinity.ts'

/** Schema version this module normalizes (optional field; missing = 1). */
export const VOICE_PACK_V1 = 1 as const

/** Hover-panel action buttons a pack can show or hide (canonical order). */
export const PANEL_ACTIONS = ['feed', 'rename', 'hide'] as const
export type PanelAction = (typeof PANEL_ACTIONS)[number]

/** Panel label slots (unset slots keep the client's i18n dictionary copy). */
export const PANEL_LABEL_KEYS = ['feed', 'rename', 'hide', 'confirm'] as const
export type PanelLabelKey = (typeof PANEL_LABEL_KEYS)[number]

/** Panel stat slots ({rank}/{n}/{points} interpolate the live values). */
export const PANEL_STAT_KEYS = ['rank', 'treats', 'points'] as const
export type PanelStatKey = (typeof PANEL_STAT_KEYS)[number]

/** Hover-panel chrome overrides served to the browser half. */
export interface PetPanelView {
  /** Button / input labels; unset slots keep the i18n dictionary copy. */
  labels?: Partial<Record<PanelLabelKey, string>>
  /** Stat line formats; unset slots keep the i18n dictionary copy. */
  stats?: Partial<Record<PanelStatKey, string>>
  /** Actions to render in canonical order; absent = all three; [] = none. */
  actions?: PanelAction[]
  /**
   * Display-only affinity ladder: replaces the built-in tier names for this
   * pet. Points, rewards, cooldowns and the persisted ledger are untouched.
   */
  ranks?: readonly AffinityRankName[]
}

/** One normalized voice pack (a pet's voice.json or the global override). */
/** Idle-chatter buckets: what the pet muses about while nothing happens. */
export const LIFE_CATEGORIES = ['generic', 'game', 'video', 'work', 'late'] as const
export type LifeCategory = (typeof LIFE_CATEGORIES)[number]

export interface VoicePack {
  /** Chatter pool overrides (draw-time merged with the built-in pools). */
  overrides: VoicePackOverrides
  /** Hover-panel chrome, when the pack declares any. */
  panel?: PetPanelView
  /** Pat/feed interaction remark pools (issue #1226). */
  remarks?: PetRemarks
  /** Affinity rank name overrides (issue #1226). */
  ranks?: Record<string, string>
  /** Idle chatter (life): what she says when left alone, per desktop context. */
  life?: Partial<Record<LifeCategory, readonly string[]>>
}

/** Hard caps shared by every pool slot (mirrors the remarks discipline). */
export const VOICE_POOL_LINES_MAX = 96
export const VOICE_LINE_MAX = 160
export const VOICE_LABEL_MAX = 40
export const VOICE_STAT_MAX = 80

/** Hard cap on a pet-declared affinity ladder (entries). */
export const RANK_LADDER_MAX = 16
/** Longest accepted rank name in a pet-declared ladder (characters). */
export const RANK_NAME_MAX = 24

/** Any '{token}' placeholder (no nesting, no newlines). */
const PLACEHOLDER_PATTERN = /{[^{}]*}/g

/** Allowed placeholder tokens per pool kind (absent kind = none allowed). */
const PLACEHOLDER_WHITELIST: Partial<Record<PoolKind, readonly string[]>> = {
  tools: ['{tool}', '{hint}'],
  toolRemaining: ['{n}'],
  stat: ['{rank}', '{n}', '{points}'],
}

type PoolKind = 'status' | 'tools' | 'toolRemaining' | 'whisperCategory' | 'whisperResult' | 'label' | 'stat'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Trim, length-cap and placeholder-check one copy line; undefined to drop. */
function normalizeLine(raw: string, kind: PoolKind, onWarning: (message: string) => void): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  let capped = trimmed.length > VOICE_LINE_MAX ? trimmed.slice(0, VOICE_LINE_MAX) : trimmed
  // The length cap may cut a placeholder token in half, leaving a dangling
  // '{' that would render literally; drop the tail from the unmatched brace.
  const dangling = capped.lastIndexOf('{')
  if (dangling !== -1 && capped.indexOf('}', dangling) === -1) {
    onWarning('line cut at an unterminated placeholder; tail dropped: ' + capped.slice(0, 40) + '...')
    capped = capped.slice(0, dangling)
  }
  if (capped === '') return undefined
  const allowed = PLACEHOLDER_WHITELIST[kind]
  const tokens = capped.match(PLACEHOLDER_PATTERN) ?? []
  for (const token of tokens) {
    if (allowed?.includes(token) === true) continue
    const preview = capped.length > 40 ? capped.slice(0, 40) + '...' : capped
    onWarning('line dropped (unsupported placeholder ' + token + '): ' + preview)
    return undefined
  }
  return capped
}

/**
 * Normalize one pool slot. Accepts a single line or an array; non-string
 * entries warn and drop, empty lines drop silently, lines over the length
 * cap truncate, illegal placeholders drop the line, and pools over the line
 * cap keep their first lines. An explicit empty pool normalizes to [] (the
 * whisper channels read that as mute) while an absent slot normalizes to
 * undefined (the slot keeps the built-in pool).
 */
export function normalizePool(
  raw: unknown,
  kind: PoolKind,
  onWarning: (message: string) => void = () => {},
): string[] | undefined {
  if (raw === undefined) return undefined
  const entries = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : undefined
  if (entries === undefined) {
    onWarning('pool must be a string or an array of strings')
    return undefined
  }
  if (entries.length > VOICE_POOL_LINES_MAX) {
    onWarning('pool has more than ' + VOICE_POOL_LINES_MAX + ' lines; extra lines are ignored')
  }
  const pool: string[] = []
  for (const entry of entries.slice(0, VOICE_POOL_LINES_MAX)) {
    if (typeof entry !== 'string') {
      onWarning('non-string pool entry dropped')
      continue
    }
    const line = normalizeLine(entry, kind, onWarning)
    if (line !== undefined) pool.push(line)
  }
  return pool
}

/** Normalize whisper category pools; a key replaces that category's built-in pool (an explicit empty pool mutes it). */
export function normalizeWhisperCategories(
  raw: unknown,
  onWarning: (message: string) => void = () => {},
): Partial<Record<WhisperCategory, readonly string[]>> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    onWarning('whispers.categories must be an object')
    return undefined
  }
  const pools: Partial<Record<WhisperCategory, readonly string[]>> = {}
  for (const key of Object.keys(raw)) {
    if (!(WHISPER_CATEGORIES as readonly string[]).includes(key)) {
      onWarning('unknown whisper category ' + key + ' ignored')
      continue
    }
    const pool = normalizePool(raw[key], 'whisperCategory', onWarning)
    if (pool !== undefined) pools[key as WhisperCategory] = pool
  }
  return Object.keys(pools).length > 0 ? pools : undefined
}

/** Normalize whisper outcome pools; a key replaces that outcome's built-in pool (an explicit empty pool mutes it). */
export function normalizeWhisperResults(
  raw: unknown,
  onWarning: (message: string) => void = () => {},
): Partial<Record<WhisperResult, readonly string[]>> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    onWarning('whispers.results must be an object')
    return undefined
  }
  const pools: Partial<Record<WhisperResult, readonly string[]>> = {}
  for (const key of Object.keys(raw)) {
    if (!(WHISPER_RESULTS as readonly string[]).includes(key)) {
      onWarning('unknown whisper result ' + key + ' ignored')
      continue
    }
    const pool = normalizePool(raw[key], 'whisperResult', onWarning)
    if (pool !== undefined) pools[key as WhisperResult] = pool
  }
  return Object.keys(pools).length > 0 ? pools : undefined
}

/** Validate one rank name slot of a declared ladder. */
function rankName(
  raw: unknown,
  index: number,
  field: 'name' | 'nameEn',
  onWarning: (message: string) => void,
): string | undefined {
  if (typeof raw !== 'string') {
    onWarning('panel.ranks[' + index + '].' + field + ' must be a string')
    return undefined
  }
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.length > RANK_NAME_MAX) {
    onWarning('panel.ranks[' + index + '].' + field + ' must be 1-' + RANK_NAME_MAX + ' characters')
    return undefined
  }
  return trimmed
}

/**
 * Normalize one pet-declared affinity ladder (`panel.ranks`). A ladder is
 * all-or-nothing: it must be an array of 1-{@link RANK_LADDER_MAX} entries,
 * start at min 0, sort ascending with unique minima, and carry names of
 * 1-{@link RANK_NAME_MAX} characters. Any violation warns and drops the
 * whole ladder, so the pet keeps the built-in names instead of a half-broken
 * ladder; a bad ladder never rejects the pet.
 */
export function normalizeRankLadder(
  raw: unknown,
  onWarning: (message: string) => void = () => {},
): AffinityRankName[] | undefined {
  if (!Array.isArray(raw)) {
    onWarning('panel.ranks must be an array')
    return undefined
  }
  if (raw.length === 0 || raw.length > RANK_LADDER_MAX) {
    onWarning('panel.ranks must contain 1-' + RANK_LADDER_MAX + ' entries')
    return undefined
  }
  const ladder: AffinityRankName[] = []
  let previousMin = -1
  for (let index = 0; index < raw.length; index++) {
    const entry = raw[index]
    if (!isRecord(entry)) {
      onWarning('panel.ranks[' + index + '] must be an object')
      return undefined
    }
    const min = entry.min
    if (typeof min !== 'number' || !Number.isSafeInteger(min) || min < 0) {
      onWarning('panel.ranks[' + index + '].min must be a non-negative integer')
      return undefined
    }
    if (index === 0 && min !== 0) {
      onWarning('panel.ranks must start at min 0')
      return undefined
    }
    if (min <= previousMin) {
      onWarning('panel.ranks must be sorted ascending with unique min values')
      return undefined
    }
    previousMin = min
    const defaultName = rankName(entry.name, index, 'name', onWarning)
    if (defaultName === undefined) return undefined
    let nameEn: string | undefined
    if (entry.nameEn !== undefined) {
      nameEn = rankName(entry.nameEn, index, 'nameEn', onWarning)
      if (nameEn === undefined) return undefined
    }
    ladder.push({ min, name: defaultName, ...(nameEn === undefined ? {} : { nameEn }) })
  }
  return ladder
}

/** Normalize the panel block (labels / stats / actions / ranks; warn-and-drop). */
export function normalizePanel(
  raw: unknown,
  onWarning: (message: string) => void = () => {},
): PetPanelView | undefined {
  if (!isRecord(raw)) {
    onWarning('panel must be an object')
    return undefined
  }
  const panel: PetPanelView = {}
  const labelsRaw = raw.labels
  if (labelsRaw !== undefined) {
    if (!isRecord(labelsRaw)) {
      onWarning('panel.labels must be an object')
    } else {
      const labels: Record<string, string> = {}
      for (const key of PANEL_LABEL_KEYS) {
        const value = labelsRaw[key]
        if (value === undefined) continue
        if (typeof value !== 'string') {
          onWarning('panel.labels.' + key + ' must be a string')
          continue
        }
        const line = normalizeLine(value, 'label', onWarning)
        if (line !== undefined) labels[key] = line.slice(0, VOICE_LABEL_MAX)
      }
      if (Object.keys(labels).length > 0) panel.labels = labels
    }
  }
  const statsRaw = raw.stats
  if (statsRaw !== undefined) {
    if (!isRecord(statsRaw)) {
      onWarning('panel.stats must be an object')
    } else {
      const stats: Record<string, string> = {}
      for (const key of PANEL_STAT_KEYS) {
        const value = statsRaw[key]
        if (value === undefined) continue
        if (typeof value !== 'string') {
          onWarning('panel.stats.' + key + ' must be a string')
          continue
        }
        const line = normalizeLine(value, 'stat', onWarning)
        if (line !== undefined) stats[key] = line.slice(0, VOICE_STAT_MAX)
      }
      if (Object.keys(stats).length > 0) panel.stats = stats
    }
  }
  const actionsRaw = raw.actions
  if (actionsRaw !== undefined) {
    if (!Array.isArray(actionsRaw)) {
      onWarning('panel.actions must be an array')
    } else {
      const seen = new Set<PanelAction>()
      for (const entry of actionsRaw) {
        if (typeof entry !== 'string' || !(PANEL_ACTIONS as readonly string[]).includes(entry)) {
          onWarning('unknown panel action dropped: ' + String(entry))
          continue
        }
        seen.add(entry as PanelAction)
      }
      // Canonical order, deduplicated; an explicit empty array hides all.
      panel.actions = PANEL_ACTIONS.filter(action => seen.has(action))
    }
  }
  const ranksRaw = raw.ranks
  if (ranksRaw !== undefined) {
    const ladder = normalizeRankLadder(ranksRaw, onWarning)
    if (ladder !== undefined) panel.ranks = ladder
  }
  if (
    panel.labels === undefined && panel.stats === undefined
    && panel.actions === undefined && panel.ranks === undefined
  ) return undefined
  return panel
}

/** Voice-pack top-level fields ('$schema' mirrors the schema twin; drift-locked in tests). */
export const VOICE_PACK_KEYS = new Set(['$schema', 'voicePackVersion', 'status', 'tools', 'toolRemaining', 'whispers', 'panel', 'remarks', 'ranks', 'life'])

/** Allowed whisper-section fields (drift-locked in tests). */
export const WHISPER_KEYS = new Set(['categories', 'results'])

/**
 * Normalize one raw voice.json document into a VoicePack, or undefined when
 * the file cannot serve as a pack at all (non-object root — structure is
 * fail-closed per file). Every slot issue is a warning, never a throw.
 */
export function normalizeVoicePack(
  raw: unknown,
  onWarning: (message: string) => void = () => {},
): VoicePack | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    onWarning('voice.json must be a JSON object; the file is ignored')
    return undefined
  }
  for (const key of Object.keys(raw)) {
    if (!VOICE_PACK_KEYS.has(key)) onWarning('unknown top-level field ' + key + ' ignored')
  }
  const version = raw.voicePackVersion
  if (version !== undefined && (typeof version !== 'number' || version !== VOICE_PACK_V1)) {
    onWarning('voicePackVersion ' + String(version) + ' is not supported; reading as v1 best-effort')
  }
  const overrides: VoicePackOverrides = {}
  const statusRaw = raw.status
  if (statusRaw !== undefined) {
    if (!isRecord(statusRaw)) {
      onWarning('status must be an object')
    } else {
      for (const key of Object.keys(statusRaw)) {
        if (!(STATUS_SCENES as readonly string[]).includes(key)) {
          onWarning('unknown status scene ' + key + ' ignored')
          continue
        }
        const pool = normalizePool(statusRaw[key], 'status', onWarning)
        if (pool !== undefined && pool.length > 0) {
          overrides.status = { ...overrides.status, [key]: pool }
        }
      }
    }
  }
  const toolsRaw = raw.tools
  if (toolsRaw !== undefined) {
    if (!isRecord(toolsRaw)) {
      onWarning('tools must be an object')
    } else {
      for (const key of Object.keys(toolsRaw)) {
        if (!(TOOL_CATEGORIES as readonly string[]).includes(key)) {
          onWarning('unknown tool family ' + key + ' ignored')
          continue
        }
        const pool = normalizePool(toolsRaw[key], 'tools', onWarning)
        if (pool !== undefined && pool.length > 0) {
          overrides.tools = { ...overrides.tools, [key]: pool }
        }
      }
    }
  }
  const remainingRaw = raw.toolRemaining
  if (remainingRaw !== undefined) {
    const pool = normalizePool(remainingRaw, 'toolRemaining', onWarning)
    if (pool !== undefined && pool.length > 0) overrides.toolRemaining = pool
  }
  const whispersRaw = raw.whispers
  if (whispersRaw !== undefined) {
    if (!isRecord(whispersRaw)) {
      onWarning('whispers must be an object')
    } else {
      for (const key of Object.keys(whispersRaw)) {
        if (key === 'generic' || key === 'rules') {
          // pet M6: keyword and ambient whisper channels are gone; legacy
          // fields are ignored with a warning, never mapped to the new shape.
          onWarning('whispers.' + key + ' is no longer supported and was ignored')
        } else if (!WHISPER_KEYS.has(key)) {
          onWarning('unknown whispers field ' + key + ' ignored')
        }
      }
      const categories = normalizeWhisperCategories(whispersRaw.categories, onWarning)
      const results = normalizeWhisperResults(whispersRaw.results, onWarning)
      if (categories !== undefined || results !== undefined) {
        overrides.whispers = {
          ...(categories === undefined ? {} : { categories }),
          ...(results === undefined ? {} : { results }),
        }
      }
    }
  }
  const panel = raw.panel === undefined ? undefined : normalizePanel(raw.panel, onWarning)
  const remarks = raw.remarks === undefined ? undefined : normalizePetRemarks(raw.remarks, onWarning)
  let life: Partial<Record<LifeCategory, readonly string[]>> | undefined
  const lifeRaw = raw.life
  if (lifeRaw !== undefined) {
    if (!isRecord(lifeRaw)) {
      onWarning('life must be an object')
    } else {
      const pools: Partial<Record<LifeCategory, readonly string[]>> = {}
      for (const [key, value] of Object.entries(lifeRaw)) {
        if (!(LIFE_CATEGORIES as readonly string[]).includes(key)) {
          onWarning('unknown life category ' + key + ' ignored')
          continue
        }
        const pool = normalizePool(value, 'whisperResult', onWarning)
        if (pool !== undefined && pool.length > 0) pools[key as LifeCategory] = pool
      }
      if (Object.keys(pools).length > 0) life = pools
    }
  }
  const ranksRaw = raw.ranks
  let ranks: Record<string, string> | undefined
  if (ranksRaw !== undefined) {
    if (!isRecord(ranksRaw)) {
      onWarning('ranks must be an object')
    } else {
      const out: Record<string, string> = {}
      for (const [key, value] of Object.entries(ranksRaw)) {
        if (typeof value === 'string' && value.trim() !== '') {
          out[key] = value.trim().slice(0, VOICE_STAT_MAX)
        } else {
          onWarning('invalid rank name for ' + key)
        }
      }
      if (Object.keys(out).length > 0) ranks = out
    }
  }
  if (
    overrides.status === undefined && overrides.tools === undefined
    && overrides.toolRemaining === undefined && overrides.whispers === undefined
    && panel === undefined && remarks === undefined && ranks === undefined
    && life === undefined
  ) {
    return undefined
  }
  return {
    overrides,
    ...(panel === undefined ? {} : { panel }),
    ...(remarks === undefined ? {} : { remarks }),
    ...(ranks === undefined ? {} : { ranks }),
    ...(life === undefined ? {} : { life }),
  }
}

/**
 * Merge voice-pack layers into one pack; later layers win per slot. The
 * built-in pools are NOT a layer here — the chatter engines fall back to
 * them per key at draw time. Merge order for a selected pet:
 * mergeVoicePacks(registry.globalVoice, entry.voice).
 */
export function mergeVoicePacks(...layers: (VoicePack | undefined)[]): VoicePack | undefined {
  const overrides: VoicePackOverrides = {}
  const labels: NonNullable<PetPanelView['labels']> = {}
  const stats: NonNullable<PetPanelView['stats']> = {}
  let remarks: PetRemarks | undefined
  let ranks: Record<string, string> | undefined
  let panelRanks: readonly AffinityRankName[] | undefined
  let actions: PanelAction[] | undefined
  let panelSeen = false
  let any = false
  for (const layer of layers) {
    if (layer === undefined) continue
    any = true
    if (layer.overrides.status !== undefined) {
      overrides.status = { ...overrides.status, ...layer.overrides.status }
    }
    if (layer.overrides.tools !== undefined) {
      overrides.tools = { ...overrides.tools, ...layer.overrides.tools }
    }
    if (layer.overrides.toolRemaining !== undefined) overrides.toolRemaining = layer.overrides.toolRemaining
    if (layer.overrides.whispers !== undefined) {
      overrides.whispers = { ...overrides.whispers, ...layer.overrides.whispers }
    }
    if (layer.panel !== undefined) {
      panelSeen = true
      if (layer.panel.labels !== undefined) Object.assign(labels, layer.panel.labels)
      if (layer.panel.stats !== undefined) Object.assign(stats, layer.panel.stats)
      if (layer.panel.actions !== undefined) actions = layer.panel.actions
      // A ladder is atomic: a declaring layer replaces the previous ladder
      // whole instead of merging tiers across layers.
      if (layer.panel.ranks !== undefined) panelRanks = layer.panel.ranks
    }
    if (layer.remarks !== undefined) {
      remarks = { ...(remarks ?? {}), ...layer.remarks }
    }
    if (layer.ranks !== undefined) {
      ranks = { ...(ranks ?? {}), ...layer.ranks }
    }
  }
  if (!any) return undefined
  const panel: PetPanelView = {
    ...(Object.keys(labels).length > 0 ? { labels } : {}),
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
    ...(actions === undefined ? {} : { actions }),
    ...(panelRanks === undefined ? {} : { ranks: panelRanks }),
  }
  const panelEmpty = panel.labels === undefined && panel.stats === undefined
    && panel.actions === undefined && panel.ranks === undefined
  return {
    overrides,
    ...(panelSeen && !panelEmpty ? { panel } : {}),
    ...(remarks !== undefined ? { remarks } : {}),
    ...(ranks !== undefined ? { ranks } : {}),
  }
}
