/**
 * Host-side gameplay lockout (gameplay.blockPhases).
 *
 * The browser gate reads the phase from a 2 s poll, so a click that leaves the
 * panel just before a turn starts can still arrive while the host already knows
 * the agent owns the sprite. The host is the authority, so the verbs themselves
 * refuse — before touching the wallet and without playing a track.
 *
 * The fixture wallet is deliberately empty: the lockout check runs BEFORE the
 * balance check, so an unlocked verb reports 'insufficient-funds' (it got as far
 * as the price) while a locked one reports 'blocked' (it never got there). That
 * contrast is the assertion, and it keeps the test independent of how treats
 * happen to be granted.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { PetService } from '../src/service.ts'
import { loadPetRegistry } from '../src/registry.ts'

const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

const MANIFEST = {
  petManifestVersion: 2,
  id: 'probe',
  displayName: 'Probe',
  license: 'MIT',
  renderer: 'frames2d',
  frames2d: {
    dir: 'thumb',
    tracks: { idle: {}, work: {}, eat: {}, pet: {} },
    phases: { idle: 'idle', thinking: 'work', tool: 'work', review: 'work' },
  },
  gameplay: {
    blockPhases: ['thinking', 'tool', 'review', 'done'],
    stats: { hunger: { max: 100 } },
    hitBox: { x0: 0, y0: 0, x1: 1, y1: 1 },
    modes: { feeding: { state: 'eat', label: 'Feed', once: true, holdMs: 2000 } },
    shop: { items: [{ id: 'box', label: 'Box', price: 1, currency: 'treats', effects: [{ stat: 'hunger', amount: 1 }] }] },
  },
}

function makeSession(id: string): Session {
  return { id } as unknown as Session
}

/** A legacy compatibility activity event: the service accepts it as a phase input. */
function activity(seq: number, phase: string) {
  return { type: 'activity/status', seq, time: seq, data: { phase } } as never
}

/** Write the fixture pet (optionally without blockPhases) and load a service. */
function build(root: string, blockPhases: string[] | undefined): { ctx: Context; service: PetService } {
  const petDir = join(root, 'assets', 'probe')
  mkdirSync(join(petDir, 'thumb', 'idle'), { recursive: true })
  writeFileSync(join(petDir, 'thumb', 'idle', 'idle_1_200.webp'), WEBP)
  for (const t of ['work', 'eat', 'pet']) {
    mkdirSync(join(petDir, 'thumb', t), { recursive: true })
    writeFileSync(join(petDir, 'thumb', t, t + '_1_200.webp'), WEBP)
  }
  const manifest = {
    ...MANIFEST,
    gameplay: { ...MANIFEST.gameplay, ...(blockPhases === undefined ? {} : { blockPhases }) },
  }
  if (blockPhases === undefined) delete (manifest.gameplay as Record<string, unknown>).blockPhases
  writeFileSync(join(petDir, 'pet.json'), JSON.stringify(manifest), 'utf8')
  const ctx = new Context()
  const service = new PetService(ctx, {
    persistDir: join(root, 'home'),
    registry: loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' }),
  })
  return { ctx, service }
}

describe('host gameplay lockout', () => {
  let dir: string
  let ctx: Context
  let service: PetService
  let session: Session

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-pet-block-'))
    const built = build(dir, MANIFEST.gameplay.blockPhases)
    ctx = built.ctx
    service = built.service
    session = makeSession('s1')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses the verbs while the agent owns the sprite, and plays no track', async () => {
    // Unlocked: the verb reaches the price (the fixture wallet is empty, so that
    // is where it stops) — i.e. the action itself is allowed.
    expect((await service.state()).phase).toBe('idle')
    const idleBuy = await service.gameplayBuy('box')
    expect(idleBuy.error).toBe('insufficient-funds')

    // The agent starts a turn; the phase becomes locked.
    ctx.emit('session/event', session, activity(1, 'tool'))
    expect((await service.state()).phase).toBe('tool')

    // Now the lockout answers first: no track is picked and no prize is drawn.
    const blockedBuy = await service.gameplayBuy('box')
    expect(blockedBuy.ok).toBe(false)
    expect(blockedBuy.error).toBe('blocked')
    expect(blockedBuy.state).toBeUndefined()
    expect(blockedBuy.prize).toBeUndefined()

    // A one-shot mode is refused the same way.
    const blockedMode = await service.gameplaySetMode('feeding')
    expect(blockedMode.ok).toBe(false)
    expect(blockedMode.error).toBe('blocked')

    // A touch reaction is refused too — it would play through the same override.
    const blockedTouch = await service.gameplayTouch('head')
    expect(blockedTouch.ok).toBe(false)
    expect(blockedTouch.error).toBe('blocked')
  })

  it('refuses a feed while the agent owns the sprite, and spends nothing', async () => {
    // A feed plays an eat animation through the same override slot the work loop
    // owns, so it is refused for the same reason a purchase is. It is also the
    // one verb that spends a treat and moves affinity, so the refusal has to
    // happen before the ledger: a blocked click must not charge the player.
    expect((await service.state()).phase).toBe('idle')

    ctx.emit('session/event', session, activity(1, 'tool'))
    const blocked = await service.interact('feed')
    expect(blocked.accepted).toBe(false)
    expect(blocked.reason).toBe('blocked')
    expect(blocked.delta).toBe(0)
    expect(blocked.state).toBeUndefined()

    // Once the phase leaves the blocked set the feed is judged normally again —
    // with an empty wallet that is 'no-treats', not 'blocked'.
    ctx.emit('session/event', session, activity(2, 'idle'))
    const unlocked = await service.interact('feed')
    expect(unlocked.accepted).toBe(false)
    expect(unlocked.reason).toBe('no-treats')
  })

  it('leaves real modes reachable, so the player can leave the state', async () => {
    // 'work' is the mode this gate protects; refusing the button that enters or
    // leaves it would strand the player behind a panel that never accepts input.
    ctx.emit('session/event', session, activity(1, 'tool'))
    const clear = await service.gameplaySetMode(null)
    expect(clear.ok).toBe(true)
  })

  it('keeps the lock through the delivery phase, not just the running phases', async () => {
    // 'done' fires on turn delivery and the phase STAYS there until the next turn
    // begins (the machine settles only the ANIMATION back to idle after
    // celebrateMs; the phase itself does not return to idle). A pack that maps
    // done onto resting work art must therefore be able to keep the lock there,
    // otherwise every delivery briefly unlocks the panel while the pet is still
    // in its work sequence.
    ctx.emit('session/event', session, activity(1, 'done'))
    expect((await service.state()).phase).toBe('done')
    const buy = await service.gameplayBuy('box')
    expect(buy.ok).toBe(false)
    expect(buy.error).toBe('blocked')
    // The pet still renders its own art: the lock refuses player actions, it
    // does not stop the phase map from driving the sprite.
    expect((await service.state()).animation).toBeTruthy()
  })

  it('accepts the verbs again once the phase leaves the blocked set', async () => {
    ctx.emit('session/event', session, activity(1, 'tool'))
    expect((await service.gameplayBuy('box')).error).toBe('blocked')
    // 'waiting' is the resting gap before a turn: not a work phase, so the panel
    // is live again even though the session itself is still active.
    ctx.emit('session/event', session, activity(2, 'waiting'))
    expect((await service.state()).phase).toBe('waiting')
    // Back to the wallet stopping it, not the lock.
    expect((await service.gameplayBuy('box')).error).toBe('insufficient-funds')
  })

  it('does not lock anything when the pack declares no blockPhases', async () => {
    // Opt-in: without the field the phase is irrelevant to the verbs.
    const plainDir = mkdtempSync(join(tmpdir(), 'dsh-pet-noblock-'))
    try {
      const built = build(plainDir, undefined)
      built.ctx.emit('session/event', makeSession('p1'), activity(1, 'tool'))
      expect((await built.service.state()).phase).toBe('tool')
      // Locked phase, but no blockPhases declared: the verb still reaches the price.
      expect((await built.service.gameplayBuy('box')).error).toBe('insufficient-funds')
    } finally {
      rmSync(plainDir, { recursive: true, force: true })
    }
  })
})
