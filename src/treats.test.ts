import { describe, expect, it } from 'vitest'
import {
  consumeTreat,
  defaultTreatConfig,
  emptyTreatLedger,
  settleTreatGrants,
} from './treats.ts'

describe('settleTreatGrants', () => {
  it('grants one treat per turnsPerTreat completed turns', () => {
    const ledger = { ...emptyTreatLedger(), turnsAtLastTreatGrant: 0 }
    const s = settleTreatGrants(ledger, 6, 1_000, defaultTreatConfig)
    expect(s.gained).toBe(2)
    expect(s.ledger.treats).toBe(2)
    expect(s.ledger.turnsAtLastTreatGrant).toBe(6)
  })

  it('grants time-output treats per elapsed period', () => {
    const ledger = { ...emptyTreatLedger(), lastTreatGrantAt: 1_000 }
    const s = settleTreatGrants(ledger, 0, 1_000 + 90 * 60_000, defaultTreatConfig)
    expect(s.gained).toBe(3)
    expect(s.ledger.treats).toBe(3)
    expect(s.ledger.lastTreatGrantAt).toBe(1_000 + 90 * 60_000)
  })

  it('does not backfill time output before the first settlement', () => {
    const ledger = emptyTreatLedger() // lastTreatGrantAt === 0
    const s = settleTreatGrants(ledger, 0, 1_000 + 10 * 60 * 60_000, defaultTreatConfig)
    expect(s.gained).toBe(0)
    expect(s.ledger).toBe(ledger)
  })

  it('caps stocked treats at maxTreats', () => {
    const ledger = { ...emptyTreatLedger(), treats: 19, lastTreatGrantAt: 1_000, turnsAtLastTreatGrant: 0 }
    const s = settleTreatGrants(ledger, 6, 1_000 + 30 * 60_000, defaultTreatConfig)
    expect(s.ledger.treats).toBe(defaultTreatConfig.maxTreats)
  })

  it('reports gained=0 and returns the same ledger when nothing is due', () => {
    const ledger = { ...emptyTreatLedger(), treats: 5, lastTreatGrantAt: 1_000, turnsAtLastTreatGrant: 0 }
    const s = settleTreatGrants(ledger, 2, 1_000 + 10_000, defaultTreatConfig)
    expect(s.gained).toBe(0)
    expect(s.ledger).toBe(ledger)
  })

  it('ignores a negative turns delta (corrupt persistence)', () => {
    const ledger = { ...emptyTreatLedger(), turnsAtLastTreatGrant: 100, lastTreatGrantAt: 1_000 }
    const s = settleTreatGrants(ledger, 50, 1_000, defaultTreatConfig)
    expect(s.gained).toBe(0)
  })

  it('a continuously working user still earns time treats (work does not reset the time anchor)', () => {
    // First settlement: 3 completed turns grant one work treat and start the
    // time clock without touching the work anchor's independence.
    let ledger = emptyTreatLedger()
    const first = settleTreatGrants(ledger, 3, 1_000, defaultTreatConfig)
    expect(first.gained).toBe(1)
    ledger = first.ledger
    // Keep working in 3-turn steps well under one time period: every work
    // settlement must advance only the turn anchor, never the time anchor.
    const stepMs = defaultTreatConfig.timeTreatMs / 100
    for (let i = 0; i < 10; i++) {
      const s = settleTreatGrants(ledger, 3 + ((i + 1) * 3), 1_000 + ((i + 1) * stepMs), defaultTreatConfig)
      expect(s.gained).toBe(1)
      expect(s.ledger.lastTreatGrantAt).toBe(1_000)
      ledger = s.ledger
    }
    // After a full time period elapses (past the anchored start), the time
    // source finally grants, proving work settlements never reset the clock.
    const late = settleTreatGrants(ledger, ledger.turnsAtLastTreatGrant, 1_000 + defaultTreatConfig.timeTreatMs, defaultTreatConfig)
    expect(late.gained).toBe(1)
    expect(late.ledger.lastTreatGrantAt).toBe(1_000 + defaultTreatConfig.timeTreatMs)
  })
})

describe('consumeTreat', () => {
  it('consumes one treat when stocked', () => {
    const r = consumeTreat({ ...emptyTreatLedger(), treats: 2 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.ledger.treats).toBe(1)
  })

  it('refuses when the stock is empty', () => {
    expect(consumeTreat(emptyTreatLedger()).ok).toBe(false)
  })
})
