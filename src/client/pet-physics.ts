/**
 * Pet physics — the optional bounce model behind the \`physics\` display switch.
 *
 * Coordinates are the same CSS insets the floating surface already writes:
 * \`right\`/\`bottom\` are distances from the viewport's right/bottom edge, so
 * \`bottom\` grows UPWARDS and \`right\` grows LEFTWARDS. \`vx\`/\`vy\` are the
 * velocities of those insets (\`vy > 0\` = rising), which keeps the integrator
 * in the exact space the renderer writes — no axis flipping in the middle.
 *
 * The model is one point body with an axis-aligned box, tuned to the same
 * numbers the standalone desktop build uses: free fall integrates the exact
 * parabola (\`y = y₀ + v·h + ½a·h²\`), every edge has its own restitution, and a
 * contact-speed correction makes a bounce leave with exactly \`e\` of the speed
 * it arrived with — so the next apex is \`e²\` of the previous one and the pet
 * visibly bounces itself out. Air drag, floor grip and a squash spring kicked
 * by the impact velocity ride on top.
 *
 * Pure and deterministic: no DOM, no timers, no globals. The caller owns the
 * clock and the bounds.
 * @module @linxin666/dsh-pet/client/pet-physics
 */

/** Tuning of the bounce model. All speeds are px/s, accelerations px/s². */
export interface PetPhysicsConfig {
  /** Downward acceleration. */
  gravity: number
  /** Speed kept on a floor bounce (0.58 ⇒ the next apex is e² ≈ 34% of it). */
  restitutionFloor: number
  /** Speed kept on a left/right viewport bounce. */
  restitutionWall: number
  /** Speed kept on a ceiling bounce (muffled on purpose). */
  restitutionCeiling: number
  /** Exponential air drag per second. */
  airDrag: number
  /** Horizontal speed multiplier applied on every floor contact. */
  floorGrip: number
  /** Exponential rolling friction while grounded, per second. */
  groundFriction: number
  /** Vertical speed below which a landing stops bouncing instead of rebounding. */
  restSpeedY: number
  /** Horizontal speed below which the pet is treated as stopped. */
  restSpeedX: number
  /** Hard speed ceiling (keeps a fast throw from tunnelling). */
  maxSpeed: number
  /** Squash impulse per px/s of impact speed. */
  squashKick: number
  /** Squash spring constant. */
  squashSpring: number
  /** Squash damping. */
  squashDamp: number
  /** Most the body may stretch (\`squash < 0\`). */
  squashMin: number
  /** Most the body may compress. */
  squashMax: number
}

/** The shipped tuning: a lively bounce that settles in a few seconds. */
export const DEFAULT_PET_PHYSICS: PetPhysicsConfig = {
  gravity: 2600,
  restitutionFloor: 0.58,
  restitutionWall: 0.66,
  restitutionCeiling: 0.42,
  airDrag: 0.22,
  floorGrip: 0.86,
  groundFriction: 7,
  restSpeedY: 58,
  restSpeedX: 18,
  maxSpeed: 6000,
  squashKick: 0.0033,
  squashSpring: 260,
  squashDamp: 19,
  squashMin: -0.24,
  squashMax: 0.44,
}

/** Integration step; small enough that a fast throw cannot cross an edge. */
export const PET_PHYSICS_SUBSTEP = 1 / 240

/** Largest frame gap the model will integrate at once (a stalled tab resumes gently). */
export const PET_PHYSICS_MAX_STEP = 0.25

/** The moving body, in CSS-inset space (see the module header). */
export interface PetPhysicsBody {
  /** Distance from the viewport's right edge, px (grows leftwards). */
  right: number
  /** Distance from the viewport's bottom edge, px (grows upwards). */
  bottom: number
  /** Velocity of \`right\`, px/s (positive = moving left). */
  vx: number
  /** Velocity of \`bottom\`, px/s (positive = rising). */
  vy: number
  /** Compression; \`> 0\` squashed, \`< 0\` stretched. */
  squash: number
  /** Compression velocity. */
  squashVel: number
  /** True while the body sits on the floor. */
  grounded: boolean
  /** True once it has stopped: grounded, no vertical speed and negligible drift. */
  resting: boolean
}

/** The box the body may move in, in the same inset space. */
export interface PetPhysicsBounds {
  /** Smallest \`right\` (the viewport's right edge, plus the pet margin). */
  minRight: number
  /** Largest \`right\` (the viewport's left edge, minus the pet width and margin). */
  maxRight: number
  /** Smallest \`bottom\` (the floor: the viewport's bottom edge, plus the margin). */
  minBottom: number
  /** Largest \`bottom\` (the ceiling, minus the pet height and margin). */
  maxBottom: number
}

/** One contact, for the caller's own feedback (art, sound, a reaction). */
export interface PetPhysicsImpact {
  /** Which edge was hit. */
  edge: 'floor' | 'wall' | 'ceiling'
  /** Contact speed, px/s (before restitution). */
  speed: number
}

/** The result of one integration step. */
export interface PetPhysicsStep {
  body: PetPhysicsBody
  impacts: PetPhysicsImpact[]
}

/** A body at rest at the given inset position. */
export function petPhysicsBodyAt(right: number, bottom: number): PetPhysicsBody {
  return { right, bottom, vx: 0, vy: 0, squash: 0, squashVel: 0, grounded: false, resting: false }
}

/** Visual squash/stretch for a body: \`sx\` widens as \`sy\` flattens. */
export function petSquashScale(squash: number): { sx: number; sy: number } {
  return { sx: 1 + squash * 0.5, sy: 1 - squash }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/**
 * Advance the body by \`dt\` seconds inside \`bounds\`.
 *
 * \`dt\` is clamped to {@link PET_PHYSICS_MAX_STEP} so a background tab that
 * resumes after seconds cannot teleport the pet through an edge, and the step is
 * split into {@link PET_PHYSICS_SUBSTEP} slices so nothing is skipped either.
 */
export function stepPetPhysics(
  body: PetPhysicsBody,
  dt: number,
  bounds: PetPhysicsBounds,
  config: PetPhysicsConfig = DEFAULT_PET_PHYSICS,
): PetPhysicsStep {
  const seconds = clamp(Number.isFinite(dt) ? dt : 0, 0, PET_PHYSICS_MAX_STEP)
  if (seconds <= 0) return { body, impacts: [] }
  const steps = Math.max(1, Math.ceil(seconds / PET_PHYSICS_SUBSTEP))
  const h = seconds / steps
  let current = body
  const impacts: PetPhysicsImpact[] = []
  for (let i = 0; i < steps; i += 1) {
    const next = substep(current, h, bounds, config)
    current = next.body
    for (const impact of next.impacts) impacts.push(impact)
  }
  const resting = current.grounded && current.vy === 0 && Math.abs(current.vx) < config.restSpeedX
  return { body: resting === current.resting ? current : { ...current, resting }, impacts }
}

function substep(
  body: PetPhysicsBody,
  h: number,
  bounds: PetPhysicsBounds,
  config: PetPhysicsConfig,
): PetPhysicsStep {
  const drag = Math.exp(-config.airDrag * h)
  let vx = body.vx * drag
  let vy = body.vy * drag
  const speed = Math.hypot(vx, vy)
  if (speed > config.maxSpeed) {
    const scale = config.maxSpeed / speed
    vx *= scale
    vy *= scale
  }

  // Exact constant-acceleration step, so a free fall carries no integrator bias.
  let right = body.right + vx * h
  let bottom = body.bottom + vy * h - 0.5 * config.gravity * h * h
  vy -= config.gravity * h

  let grounded = false
  let squashVel = body.squashVel
  const impacts: PetPhysicsImpact[] = []

  // Floor. The step lands \`pen\` px past the contact point, so the true contact
  // speed is recovered from the energy relation — otherwise every bounce would
  // come back a hair too fast and the decay would not be exactly e².
  if (bottom < bounds.minBottom) {
    const pen = bounds.minBottom - bottom
    bottom = bounds.minBottom
    const contact = Math.sqrt(Math.max(0, vy * vy - 2 * config.gravity * pen))
    if (contact > config.restSpeedY) {
      vy = contact * config.restitutionFloor
      vx *= config.floorGrip
      squashVel += Math.min(contact, 2000) * config.squashKick
      impacts.push({ edge: 'floor', speed: contact })
    } else {
      vy = 0
    }
    grounded = true
  }

  // Ceiling: a muffled bounce, so a pet thrown upward does not ping-pong.
  if (bottom > bounds.maxBottom) {
    const pen = bottom - bounds.maxBottom
    bottom = bounds.maxBottom
    const contact = Math.sqrt(Math.max(0, vy * vy + 2 * config.gravity * pen))
    if (contact > config.restSpeedY) {
      vy = -contact * config.restitutionCeiling
      impacts.push({ edge: 'ceiling', speed: contact })
    } else {
      vy = 0
    }
  }

  // Viewport sides: \`right\` grows leftwards, so a small \`right\` is the right wall.
  if (right < bounds.minRight) {
    const contact = -vx
    right = bounds.minRight
    if (contact > config.restSpeedX) {
      vx = contact * config.restitutionWall
      impacts.push({ edge: 'wall', speed: contact })
    } else {
      vx = 0
    }
  } else if (right > bounds.maxRight) {
    const contact = vx
    right = bounds.maxRight
    if (contact > config.restSpeedX) {
      vx = -contact * config.restitutionWall
      impacts.push({ edge: 'wall', speed: contact })
    } else {
      vx = 0
    }
  }

  if (grounded) {
    vx *= Math.exp(-config.groundFriction * h)
    if (Math.abs(vx) < config.restSpeedX) vx = 0
    // `bottom` grows upwards, so a negative vy is the body pressing INTO the
    // floor: cancel that, never the rebound (a positive vy is the pet rising).
    if (vy < 0) vy = 0
  }

  const accel = squashVel + (-config.squashSpring * body.squash - config.squashDamp * squashVel) * h
  const squash = clamp(body.squash + accel * h, config.squashMin, config.squashMax)

  return { body: { right, bottom, vx, vy, squash, squashVel: accel, grounded, resting: false }, impacts }
}
