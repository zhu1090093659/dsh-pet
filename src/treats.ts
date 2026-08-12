/**
 * Treat (小鱼干) economy — pure, clock-injected. The pet's food comes from
 * two sources, both tied to companionship:
 *  - work output: every N completed turns grant one treat;
 *  - time output: every T minutes of wall-clock time grant one treat.
 * Feeding consumes one treat. Settlement is lazy: it runs whenever the host
 * serves a state snapshot or an interaction, so there is no timer and no
 * drift — elapsed periods are computed from the persisted last-grant marks.
 * @module @deepseek-ai/dsh-pet/treats
 */

/** Treat economy tuning. */
export interface TreatConfig {
  /** Completed turns per work-output treat. */
  turnsPerTreat: number
  /** Wall-clock ms per time-output treat. */
  timeTreatMs: number
  /** Hard cap on stocked treats. */
  maxTreats: number
}

export const defaultTreatConfig: TreatConfig = {
  turnsPerTreat: 3,
  timeTreatMs: 30 * 60_000,
  maxTreats: 20,
}

/** Treat ledger as persisted inside PetPersist. */
export interface TreatLedger {
  /** Current stocked treats (0..maxTreats). */
  treats: number
  /** Epoch ms of the last time-output settlement (0 = never settled). */
  lastTreatGrantAt: number
  /** Affinity turns counter at the last work-output settlement. */
  turnsAtLastTreatGrant: number
}

export function emptyTreatLedger(): TreatLedger {
  return { treats: 0, lastTreatGrantAt: 0, turnsAtLastTreatGrant: 0 }
}

/** Outcome of one settlement pass. */
export interface TreatSettlement {
  /** Mutated ledger (caller persists it). */
  ledger: TreatLedger
  /** Treats gained in this pass (work + time). */
  gained: number
}

function cap(treats: number, max: number): number {
  return Math.min(max, Math.max(0, treats))
}

/**
 * Settle treat grants from both sources against one ledger snapshot.
 * Work output counts whole periods since the last settlement
 * (turnsDelta / turnsPerTreat); time output counts whole periods since
 * lastTreatGrantAt (0 treats history never backfills — the clock starts at
 * the first settlement). Both sources are clamped by the stock cap.
 */
export function settleTreatGrants(
  ledger: TreatLedger,
  turns: number,
  nowMs: number,
  config: TreatConfig = defaultTreatConfig,
): TreatSettlement {
  const turnDelta = Math.max(0, turns - ledger.turnsAtLastTreatGrant)
  const workGrants = Math.floor(turnDelta / config.turnsPerTreat)
  const timeGrants = ledger.lastTreatGrantAt === 0
    ? 0
    : Math.floor(Math.max(0, nowMs - ledger.lastTreatGrantAt) / config.timeTreatMs)
  const gained = workGrants + timeGrants
  if (gained <= 0) return { ledger, gained: 0 }
  return {
    ledger: {
      treats: cap(ledger.treats + gained, config.maxTreats),
      lastTreatGrantAt: nowMs,
      turnsAtLastTreatGrant: turns - (turnDelta % config.turnsPerTreat),
    },
    gained,
  }
}

/**
 * Consume one treat for a feed. Returns the outcome; a feed with no stocked
 * treats is refused.
 */
export function consumeTreat(
  ledger: TreatLedger,
): { ok: true; ledger: TreatLedger } | { ok: false } {
  if (ledger.treats <= 0) return { ok: false }
  return { ok: true, ledger: { ...ledger, treats: ledger.treats - 1 } }
}
