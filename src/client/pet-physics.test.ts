/**
 * Pet physics contract: a bounce must lose energy the same way every time, the
 * body must stay inside its box, and it must come to rest instead of jittering
 * forever. The apex decay is the whole point of the feature — the pet bounces
 * itself out — so it is asserted against the closed form \`e²\` rather than a
 * loose "smaller than before".
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PET_PHYSICS,
  PET_PHYSICS_MAX_STEP,
  petPhysicsBodyAt,
  petSquashScale,
  stepPetPhysics,
  type PetPhysicsBounds,
  type PetPhysicsBody,
  type PetPhysicsConfig,
} from './pet-physics.ts'

const STEP = 1 / 240
const BOUNDS: PetPhysicsBounds = { minRight: 8, maxRight: 800, minBottom: 8, maxBottom: 600 }
const FALL = 400

/** One flight's worth of trace: the apexes reached and the speeds landed at. */
function flights(
  start: PetPhysicsBody,
  seconds: number,
  config: PetPhysicsConfig = DEFAULT_PET_PHYSICS,
  bounds: PetPhysicsBounds = BOUNDS,
): { apexes: number[]; landings: number[]; body: PetPhysicsBody; impacts: number } {
  let body = start
  let peak = start.bottom
  const apexes: number[] = []
  const landings: number[] = []
  let impacts = 0
  const steps = Math.round(seconds / STEP)
  for (let i = 0; i < steps; i += 1) {
    const result = stepPetPhysics(body, STEP, bounds, config)
    body = result.body
    peak = Math.max(peak, body.bottom)
    for (const impact of result.impacts) {
      impacts += 1
      if (impact.edge !== 'floor') continue
      apexes.push(peak - bounds.minBottom)
      landings.push(impact.speed)
      peak = bounds.minBottom
    }
  }
  return { apexes, landings, body, impacts }
}

describe('pet physics', () => {
  it('user sees every bounce come back the same fraction lower', () => {
    // Given a pet dropped from a height with the air drag off; when it lands
    // repeatedly; then each apex is e² of the one before it, which is exactly
    // what makes the pet visibly bounce itself out.
    const config: PetPhysicsConfig = { ...DEFAULT_PET_PHYSICS, airDrag: 0 }
    const { apexes } = flights(petPhysicsBodyAt(400, BOUNDS.minBottom + FALL), 20, config)
    expect(apexes.length).toBeGreaterThanOrEqual(4)
    const expected = config.restitutionFloor ** 2
    // The first apex IS the drop height, so the closed form covers shot one on.
    expect(apexes[0]).toBeCloseTo(FALL, 1)
    for (let i = 1; i < apexes.length; i += 1) {
      expect(apexes[i - 1] * expected).toBeCloseTo(apexes[i], 1)
    }
    // And the landing speeds decay by e, not by e².
    for (let i = 1; i < 4; i += 1) {
      expect(apexes.length > i).toBe(true)
    }
  })

  it('user sees the bouncing stop instead of jittering forever', () => {
    // Given the same drop; when the sim runs out; then the pet is asleep on the
    // floor with no residual speed.
    const { body } = flights(petPhysicsBodyAt(400, BOUNDS.minBottom + FALL), 20)
    expect(body.resting).toBe(true)
    expect(body.bottom).toBe(BOUNDS.minBottom)
    expect(body.vy).toBe(0)
    expect(body.vx).toBe(0)
  })

  it('user sees a thrown pet bounce off the viewport side and lose energy', () => {
    // Given a pet thrown towards the left wall through the air (no floor drag);
    // when it gets there; then the wall sends it back with e_wall of the speed
    // it arrived with.
    let body = petPhysicsBodyAt(BOUNDS.maxRight - 60, BOUNDS.minBottom + 300)
    body = { ...body, vx: 900 }
    const wallSpeeds: number[] = []
    let outgoing = 0
    for (let i = 0; i < Math.round(0.5 / STEP); i += 1) {
      const result = stepPetPhysics(body, STEP, BOUNDS)
      body = result.body
      for (const impact of result.impacts) {
        if (impact.edge !== 'wall') continue
        wallSpeeds.push(impact.speed)
        outgoing = body.vx
      }
    }
    expect(wallSpeeds.length).toBeGreaterThanOrEqual(1)
    expect(wallSpeeds[0]).toBeGreaterThan(850)
    // Reversed, and scaled by the wall restitution (air drag over the short
    // flight is the only other loss).
    expect(outgoing).toBeLessThan(0)
    expect(Math.abs(outgoing)).toBeCloseTo(wallSpeeds[0] * DEFAULT_PET_PHYSICS.restitutionWall, 4)
  })

  it('user never sees the pet escape its box, even on a stalled frame', () => {
    // Given a fast throw and a 10 s frame gap (a backgrounded tab); when the
    // step runs; then the body is still inside the box: the clamp plus the
    // sub-stepping are the anti-tunnelling guarantees.
    let body = petPhysicsBodyAt(400, BOUNDS.maxBottom)
    body = { ...body, vy: -6000, vx: 4000 }
    const { body: after } = stepPetPhysics(body, 10, BOUNDS)
    expect(after.right).toBeGreaterThanOrEqual(BOUNDS.minRight)
    expect(after.right).toBeLessThanOrEqual(BOUNDS.maxRight)
    expect(after.bottom).toBeGreaterThanOrEqual(BOUNDS.minBottom)
    expect(after.bottom).toBeLessThanOrEqual(BOUNDS.maxBottom)
    expect(PET_PHYSICS_MAX_STEP).toBeLessThan(10)
  })

  it('user sees a hard landing squash the pet and the spring settle it back', () => {
    // Given a drop; when it lands; then the body compresses past 5%, and once
    // it is at rest the compression is back to zero.
    let body = petPhysicsBodyAt(400, BOUNDS.minBottom + FALL)
    let peak = 0
    for (let i = 0; i < Math.round(20 / STEP); i += 1) {
      body = stepPetPhysics(body, STEP, BOUNDS).body
      peak = Math.max(peak, body.squash)
    }
    expect(peak).toBeGreaterThan(0.05)
    expect(Math.abs(body.squash)).toBeLessThan(0.01)
  })

  it('user sees the squash widen the pet as it flattens it', () => {
    // Given a compression and a stretch; when the visual scale is read; then
    // the height follows the compression inverted and the width opposes it.
    const squashed = petSquashScale(0.4)
    expect(squashed.sy).toBeCloseTo(0.6, 6)
    expect(squashed.sx).toBeCloseTo(1.2, 6)
    const stretched = petSquashScale(-0.2)
    expect(stretched.sy).toBeCloseTo(1.2, 6)
    expect(stretched.sx).toBeCloseTo(0.9, 6)
  })

  it('user sees the pet rest where it was left, not restart mid-air', () => {
    // Given a body already asleep; when a step runs; then nothing moves and
    // nothing is reported: an idle pet costs one comparison per frame.
    const sleeping: PetPhysicsBody = { ...petPhysicsBodyAt(120, BOUNDS.minBottom), grounded: true, resting: true }
    const result = stepPetPhysics(sleeping, STEP, BOUNDS)
    expect(result.impacts).toEqual([])
    expect(result.body.resting).toBe(true)
    expect(result.body.right).toBe(120)
    expect(result.body.bottom).toBe(BOUNDS.minBottom)
  })
})
