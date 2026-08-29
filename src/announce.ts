/**
 * The pet announcement-bubble contract (dsh-usage linkage): a sibling plugin
 * pushes one structured announcement through `pet.announce(...)`, the host
 * validates it into a bounded payload, and the browser half renders it as a
 * dedicated, specially styled bubble above the session bubble stack.
 *
 * The validation lives in this pure module so the wire contract has exactly
 * one home and stays testable without the cordis service.
 * @module @linxin666/dsh-pet/announce
 */

/** One plugin-authored announcement bubble. */
export interface PetAnnouncement {
  /** Authoring plugin's source tag (`dsh-usage` for the usage statistics). */
  source: string
  /** Bubble content kind: an account balance or a plan-quota status. */
  kind: 'balance' | 'plan'
  /** Lead text (usually the provider display name). */
  title: string
  /** Balance amount, formatted for display (kind `balance`). */
  amount?: string
  /** Plan usage percent 0-100 (kind `plan`). */
  percent?: number
  /** ISO 8601 reset instant (kind `plan`). */
  resetAt?: string
  /** Short trailing note (plan tier name, currency code, ...). */
  note?: string
  /** Visual tone; drives the bubble's accent color. */
  tone: 'ok' | 'warn' | 'low'
  /** Freshness window in ms; an expired announcement stops rendering. */
  ttlMs: number
  /** Epoch ms the announcement arrived. */
  at: number
}

/** Default freshness window. */
export const ANNOUNCE_DEFAULT_TTL_MS = 10_000

/** Hard bounds: lengths and the TTL range (1 s .. 60 s). */
const TITLE_MAX = 80
const TEXT_MAX = 120
const SOURCE_MAX = 64

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max)
}

/**
 * Validate one announce payload. Unknown fields are dropped, oversized text
 * is truncated, and anything structurally wrong resolves to undefined — a
 * malformed announcement never reaches the pet's bubble surface.
 * @param input - the payload a sibling plugin passed to `pet.announce`.
 * @param now - epoch ms the announcement arrived.
 */
export function parseAnnouncement(input: unknown, now: number): PetAnnouncement | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const data = input as Record<string, unknown>
  const source = boundedString(data.source, SOURCE_MAX)
  const title = boundedString(data.title, TITLE_MAX)
  if (source === undefined || title === undefined) return undefined
  const kind = data.kind === 'balance' || data.kind === 'plan' ? data.kind : undefined
  if (kind === undefined) return undefined
  const amount = boundedString(data.amount, TEXT_MAX)
  const resetAt = boundedString(data.resetAt, TEXT_MAX)
  const note = boundedString(data.note, TITLE_MAX)
  const percent = typeof data.percent === 'number' && Number.isFinite(data.percent)
    ? Math.max(0, Math.min(100, data.percent))
    : undefined
  if (kind === 'balance' && amount === undefined) return undefined
  if (kind === 'plan' && percent === undefined) return undefined
  const tone = data.tone === 'warn' || data.tone === 'low' ? data.tone : 'ok'
  const ttlMs = typeof data.ttlMs === 'number' && Number.isFinite(data.ttlMs)
    ? Math.max(1000, Math.min(60_000, data.ttlMs))
    : ANNOUNCE_DEFAULT_TTL_MS
  return {
    source,
    kind,
    title,
    ...(amount !== undefined ? { amount } : {}),
    ...(percent !== undefined ? { percent } : {}),
    ...(resetAt !== undefined ? { resetAt } : {}),
    ...(note !== undefined ? { note } : {}),
    tone,
    ttlMs,
    at: now,
  }
}

/** Whether an announcement is still fresh at `now`. */
export function announcementFresh(announcement: PetAnnouncement, now: number): boolean {
  return now - announcement.at < announcement.ttlMs
}
