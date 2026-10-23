/**
 * Gameplay HUD — the client half of the manifest 'gameplay' block (miku-pet
 * generalization). One component owns everything the block needs: the stat
 * bars and shop card (menu / shop pages), the touch-zone tap
 * handling, the idle director rolls, the work and sleep loops, and the
 * float-text toasts. It talks to the host through the injected verb API,
 * writes results straight back into the store (the 2 s poll stays the
 * backstop), and steers the frames2d renderer through the per-pet bus.
 * @module @linxin666/dsh-pet/client/GameplayHud
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDefinition, PetSkinDefinition } from '../registry.ts'
import type { PetGameplayVerbResult, PetInteractResult } from '../service.ts'
import type { PetInteraction } from '../affinity.ts'
import type { ActivityPhase } from '../state.ts'
import { declaredModes, isOneShotMode, modeStateOf, oneShotHoldMsOf, PET_ROAM_DIRECTIONS, pickFeedTrack, touchZoneAt, type PetGameplayFeedDef, type PetRoamDirection } from '../gameplay.ts'
import type { PetStoreInstance } from './pet-store.ts'
import type { DragStream } from './drag-stream.ts'
import type { NS } from './locales.ts'
import styles from './pet.module.css'

/** The gameplay verb API the plugin apply body injects (host-authoritative). */
export interface GameplayApi {
  touch: (zone?: string) => Promise<PetGameplayVerbResult>
  setMode: (mode: string | null) => Promise<PetGameplayVerbResult>
  workTick: () => Promise<PetGameplayVerbResult>
  buy: (item: string) => Promise<PetGameplayVerbResult>
  /**
   * Pet or feed the pet. The button reaction animation has to run here rather
   * than in the plugin's own injected action: the renderer's track override is
   * owned by this HUD (through the bus), while `PetInjected.feed` lives in the
   * apply body and cannot reach it.
   */
  interact: (kind: PetInteraction) => Promise<PetInteractResult>
  /**
   * Persist the selected skin for the current pet (host-authoritative;
   * `undefined` restores the pet's default look).
   */
  setSkin: (skin: string | undefined) => Promise<{ ok: boolean; error?: string }>
}

/**
 * The per-pet coordination bus. The frames2d visual mount registers the
 * track override (setTrack); the HUD registers the sprite tap handler; the
 * chrome calls into whatever is registered. Optional chaining everywhere —
 * either side may be mid-remount during a hot reload.
 */
export interface GameplayBus {
  setTrack?: (track?: string) => void
  /** Swap the pet's base idle track (skin switch); undefined restores default. */
  setIdleTrack?: (track?: string) => void
  /**
   * The base idle track the HUD wants right now, latched on the bus so a
   * renderer that registers late (or remounts: hidden/summoned, StrictMode's
   * double mount) still applies the restored skin instead of snapping back to
   * the default look. Mutating it never requires a re-render.
   */
  idleTrack?: string
  tap?: (fx: number, fy: number) => void
  /**
   * Card open/close request from the chrome (the hover panel's 玩法 action):
   * the HUD registers this, and calling it with no argument toggles the card
   * while a boolean pins the state (same chrome -> HUD direction as tap).
   */
  openCard?: (open?: boolean) => void
  /**
   * Walk the sprite in `direction` by `distance` px at `speed` px/s, clamped
   * to the viewport, and persist the resting spot like a drag. Returns the
   * distance actually travelled (0 when it cannot move), so the caller can
   * hold the walk art for exactly that long. Registered by the chrome
   * (PetSprite); absent while the sprite is unmounted.
   */
  walk?: (direction: PetRoamDirection, distance: number, speed: number) => number
  /**
   * The hover panel's feed/pet button action. Registered by the HUD (which
   * owns the track override, the interruption lock and the feedback bubble) so
   * a manifested `gameplay.feed.track` plays even though the button lives in
   * the chrome. The chrome falls back to the injected action when this is
   * absent — a pet with no gameplay block keeps the old behaviour.
   *
   * `kind` lets one registration serve both buttons: only the feed kind picks
   * up `gameplay.feed` art, while a plain pet keeps the phase-driven look.
   */
  feed?: (kind: PetInteraction) => void
}

type HudPage = 'root' | 'shop' | 'skins'

/** One floating toast (prize / insufficient funds). */
interface HudFloat {
  id: number
  text: string
}

let floatSeq = 0

/** The gameplay overlay for one frames2d pet that declares 'gameplay'. */
export function GameplayHud(props: {
  definition: PetDefinition
  store: PetStoreInstance
  api: GameplayApi
  bus: GameplayBus
  drag: DragStream
  t: PropsLocale<typeof NS>['t']
}): ReactElement | null {
  const { definition, store, api, bus } = props
  const ui = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const def = definition.gameplay
  const view = ui.snapshot?.gameplay
  // Host-persisted skin selection for this pet (undefined = default look).
  const persistedSkin = ui.snapshot?.skin

  // ── Work-phase lockout ──
  // A pet that maps its ActivityPhases onto work art (walk to the desk, work
  // loop, wrap-up) owns the sprite while the agent runs. A purchase, a feed
  // button or a pet click would grab the same track override mid-animation and
  // the sprite would flip between "working" and "eating" — which reads as a
  // rendering bug, not as two features. The pack names the phases it wants
  // cleared in gameplay.blockPhases; the panel still opens (stats and the shop
  // stay readable), only the actions that would steal the track are refused.
  const blockedPhase = ui.snapshot?.phase
  const blocked = blockedPhase !== undefined && def?.blockPhases?.includes(blockedPhase) === true
  // The ref is only for render-time affordances (greying). Every GUARD reads the
  // phase straight from the store at click time instead: the phase arrives on a
  // 2 s poll, so a ref refreshed during render lags behind it, and a click in
  // that window slipped through — which is exactly how a "grayed" 商店 button
  // still opened the shop on the second or third press.
  const blockedRef = useRef(false)
  blockedRef.current = blocked
  const isBlockedNow = (): boolean => {
    const phase = store.getSnapshot().snapshot?.phase
    return phase !== undefined && def?.blockPhases?.includes(phase) === true
  }

  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<HudPage>('root')
  // Currently selected skin id (base idle swap); undefined = default look.
  const [skinId, setSkinId] = useState<string | undefined>(undefined)
  const skinIdRef = useRef<string | undefined>(undefined)
  skinIdRef.current = skinId
  const hudRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [floats, setFloats] = useState<HudFloat[]>([])
  // ★ When the agent takes the sprite, drop the panel back to its root page.
  // The greying plus the guards are the enforcement, but a player who opened the
  // shop before the turn started would otherwise sit in front of live-looking
  // cells and have to discover that clicking them does nothing. Bouncing to the
  // root page makes the lockout visible instead of something to be found out.
  // (The store can flip the phase before React re-renders, so the guards still
  // read it at click time; this is the affordance, not the gate.)
  useEffect(() => {
    if (blocked) setPage('root')
  }, [blocked])
  // Mutable driver state (refs so intervals never re-arm on a poll tick).
  const modeRef = useRef<string | null>(view?.mode ?? null)
  modeRef.current = view?.mode ?? null
  /** Live gameplay view for the interval loops (def identity is stable, view is not). */
  const viewRef = useRef(view)
  viewRef.current = view
  const draggingRef = useRef(false)
  const touchLockUntilRef = useRef(0)
  /**
   * Interruption lock for the panel-button reaction animation. A separate ref
   * from the touch lock because the two are taken in different places: the tap
   * path takes the touch lock, the panel feed path takes this one, and each
   * must be honoured by the other so a tap cannot cut a feed short and a feed
   * cannot be restarted by a second click.
   */
  const feedLockUntilRef = useRef(0)
  /**
   * Identity of the override currently held: only the holder that set it may
   * clear it.
   *
   * Every beat schedules its own release timer, and those timers keep running
   * even after a later beat takes the track. Guarding only on the caller's own
   * lock ref was not enough — an earlier wrap-up's timer would clear a feed
   * animation that was still playing, which looked like the last frames of the
   * basin flip being dropped.
   */
  const trackHoldTokenRef = useRef(0)
  /** A feed interaction is in flight (an answer is still owed). */
  const feedBusyRef = useRef(false)
  /**
   * A one-shot mode's reaction owns the pet right now. Kept separate from the
   * feed lock so a running feed can never be swallowed by an unrelated
   * one-shot button, and mirrored into state only to disable that button while
   * its own animation plays.
   */
  const oneShotLockUntilRef = useRef(0)
  /** Id of the one-shot mode currently playing (null = none), for the button. */
  const [runningOnce, setRunningOnce] = useState<string | null>(null)
  /** A purchase is in flight (an answer is still owed). */
  const buyBusyRef = useRef(false)
  const missRef = useRef(0)
  const busyRef = useRef(false)
  /** A roam walk owns the visual right now (the idle director must not steal it). */
  const roamHeldRef = useRef(false)
  /** A one-shot idle-director act owns the visual right now (the roam must not cut in). */
  const actHeldRef = useRef(false)
  /** Pending release of the roam's walk track (cleared when another owner takes it). */
  const roamTimerRef = useRef(0)

  // Dynamic-key lookups (stat ids / currency ids are manifest data).
  const tr = props.t as unknown as (key: string, values?: Record<string, string | number>) => string
  const statLabel = (name: string): string => tr('pet.gameplay.stat.' + name)
  const currencyLabel = (name: string): string => tr('pet.gameplay.currency.' + name)

  const pushFloat = (text: string): void => {
    const id = ++floatSeq
    setFloats(list => [...list.slice(-3), { id, text }])
    window.setTimeout(() => {
      setFloats(list => list.filter(entry => entry.id !== id))
    }, 1100)
  }

  /**
   * Refuse a gameplay interaction because the agent owns the sprite right now,
   * and say so once. Every locked entry point funnels through here so the pet
   * gives the same answer whether the click came from a button or the sprite.
   */
  const refuseWhileBlocked = (): boolean => {
    if (!isBlockedNow()) return false
    pushFloat(tr('pet.gameplay.busy'))
    return true
  }

  /**
   * Grey out an action while the agent owns the sprite. Applied to *every*
   * gameplay action rather than to a hand-picked few: the first pass only
   * greyed the one-shot mode buttons and the shop cells, so 商店 / 皮肤 / 返回
   * still opened their pages mid-work and the lockout looked broken.
   *
   * Kept clickable rather than `disabled`: `disabled` swallows the tooltip and
   * gives the user no reason for the dead click, while a click here floats the
   * busy line. The gate itself lives in buy/setMode/tap, so this is only the
   * affordance.
   */
  const actionClass = (base: string, locked = blocked): string =>
    locked ? base + ' ' + styles.actionBlocked : base
  const blockedTitle = (fallback?: string): string | undefined =>
    blocked ? tr('pet.gameplay.busy') : fallback

  const applyResult = (result: PetGameplayVerbResult): void => {
    if (result.view !== undefined) store.actions.setGameplayView(result.view)
  }

  /**
   * Give up the roam's claim on the shared track-override slot. Every other
   * owner (a mode, a touch reaction, a drag) calls this before it takes the
   * slot, so a walk that is still in flight can never release someone else's
   * track when its own hold window elapses.
   */
  const yieldRoam = (): void => {
    if (roamTimerRef.current !== 0) {
      window.clearTimeout(roamTimerRef.current)
      roamTimerRef.current = 0
    }
    roamHeldRef.current = false
  }

  /**
   * Play a one-shot override track and lock input for its duration, so
   * consecutive clicks cannot retrigger it mid-play (skin click actions,
   * default touch-zone reactions and the panel feed animation all share this
   * path). The lock is written on a caller-supplied ref because the tap path
   * and the feed path must honour each other's hold windows.
   */
  const holdLockedTrack = (track: string, holdMs: number, lockRef: { current: number }): void => {
    yieldRoam()
    bus.setTrack?.(track)
    lockRef.current = Date.now() + holdMs
    // Only the newest holder may release the override. Without this the release
    // timer of an earlier beat (a wrap-up ending, a previous feed) fires on its
    // own clock and clears the track a LATER animation is still playing, which
    // showed up as "the last few frames of the basin flip are always missing".
    const token = ++trackHoldTokenRef.current
    window.setTimeout(() => {
      if (token !== trackHoldTokenRef.current) return
      if (Date.now() >= lockRef.current) bus.setTrack?.(undefined)
    }, holdMs)
  }

  /**
   * Slack added when a hold is derived from a track's own play time.
   *
   * The renderer starts its frame chain on the next animation frame after the
   * override is set, so the real play time is a frame or so longer than the sum
   * of the durations. Releasing at exactly that sum clipped the final frame of
   * long tracks (an 80-frame basin flip lost its last frames every time).
   */
  const TRACK_HOLD_GRACE_MS = 200

  /** Total play time of a declared track (0 for an undeclared/empty one). */
  const trackDuration = (track: string): number =>
    definition.frames2d?.tracks[track]?.durations.reduce((sum, ms) => sum + ms, 0) ?? 0

  // ── Work start / end beats ──
  // The phase stream cannot express "a work session started": its `waiting`
  // phase fires at every turn start, every step start and whenever the agent
  // blocks for approval, and DSH chains turns — a delivered stage immediately
  // starts the next one. Binding an entry animation to a phase therefore
  // replays it several times per task.
  //
  // `sessionActive` looks like the boundary, but it is not one in practice: a
  // conversation keeps ONE session alive for hours, so the flag is already true
  // on first paint, never rises again, and a page reload would silently lose
  // the entry animation altogether.
  //
  // What the ear actually wants is "a burst of work started": entering a work
  // phase after the pet has been out of work for a while. Chained turns are
  // milliseconds apart and stay inside the gap, so they do not replay it, while
  // picking the conversation back up after a pause does.
  //
  // The EXIT is per-turn by contrast: it hangs off the `done` phase, and is
  // held through the override slot because the next turn's `waiting` arrives
  // within the 2.4 s the wrap-up needs and would otherwise cut it short.
  const WORK_ENTRY_GAP_MS = 6_000
  const WORK_PHASES = new Set<ActivityPhase>(['waiting', 'thinking', 'tool', 'review'])
  const workBeatLockRef = useRef(0)
  const phaseWasRef = useRef<ActivityPhase | undefined>(undefined)
  const offWorkAtRef = useRef<number | undefined>(undefined)
  const everWorkedRef = useRef(false)
  const playBeat = (beat: PetGameplayFeedDef | undefined): void => {
    if (beat === undefined) return
    const picked = pickFeedTrack(beat)
    if (picked === undefined) return
    const declared = definition.frames2d?.tracks[picked]
    if (declared === undefined) return
    const hold = beat.holdMs
      ?? (declared.loop === false ? (trackDuration(picked) + TRACK_HOLD_GRACE_MS) : 2000)
    holdLockedTrack(picked, hold, workBeatLockRef)
  }
  useEffect(() => {
    const phase = ui.snapshot?.phase
    if (phase === undefined) return
    const previous = phaseWasRef.current
    phaseWasRef.current = phase
    const now = Date.now()
    const working = WORK_PHASES.has(phase)
    const wasWorking = previous === undefined ? undefined : WORK_PHASES.has(previous)
    if (working) {
      // Entering work: a fresh burst if the pet has been resting long enough.
      // The very first work of the page always counts — otherwise a pet that
      // was loaded while idle would skip its entry animation entirely.
      if (wasWorking !== true) {
        const gap = !everWorkedRef.current || offWorkAtRef.current === undefined
          ? Infinity
          : now - offWorkAtRef.current
        // The pack decides how long a pause counts as walking away; the default
        // is deliberately short and reads as random on a normal reply cycle.
        if (gap >= (def?.workEntry?.gapMs ?? WORK_ENTRY_GAP_MS)) playBeat(def?.workEntry)
      }
      everWorkedRef.current = true
    } else {
      offWorkAtRef.current = now
    }
    // Rising edge onto `done` only: a repeated poll must not restart the wrap-up.
    if (previous !== 'done' && phase === 'done') playBeat(def?.workExit)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- edges only
  }, [ui.snapshot?.phase])
  // Every abnormal ending — an error, the token budget running out, or the user
  // pressing stop — arrives with a fresh `interruptedAt` stamp. A stopped turn
  // projects the calm idle phase, so the phase edge above can never see it; one
  // stamp is one beat, whichever kind of ending produced it.
  const interruptedWasRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    const at = ui.snapshot?.interruptedAt
    if (at === undefined || at === interruptedWasRef.current) return
    interruptedWasRef.current = at
    // A failure has its own phase, and a pack may map that phase straight onto
    // the interruption art. Playing the beat as well would restart the same
    // track a frame after the phase map already started it, which reads as a
    // stutter. Stop for the pack; one beat per ending.
    if (ui.snapshot?.phase === 'failed') return
    playBeat(def?.workInterrupt)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stamp edges only
  }, [ui.snapshot?.interruptedAt])

  // Tap handling (registered on the bus; PetSprite reports sprite-box
  // fractions). Sleep wakes on tap; work blocks taps; a held touch
  // animation turns taps into the plain-click boost.
  // Skin contract: while a skin is selected, taps only ever play that
  // skin's own click actions — a miss resolves to the plain click boost,
  // never the default touch zones (so a skinned pet cannot trigger the
  // default pet's shy/work reactions).
  useEffect(() => {
    if (def === undefined) return undefined
    const speak = (phrases?: string[]): void => {
      if (phrases !== undefined && phrases.length > 0) {
        const phrase = phrases[Math.floor(Math.random() * phrases.length)]!
        store.actions.setFeedback({ text: phrase, kind: 'none', at: Date.now() })
      }
    }
    /** The tap path's hold: the shared one-shot override on the touch lock. */
    const holdTrack = (track: string, holdMs: number): void =>
      holdLockedTrack(track, holdMs, touchLockUntilRef)
    bus.tap = (fx, fy) => {
      // The work lockout comes first: while the agent owns the sprite, a click
      // must not speak a bubble or start a touch animation over the work art.
      // (It is deliberately silent here — the sprite is small and the panel
      // already says why the buttons are gray; floating a toast on every click
      // would be noise.)
      if (isBlockedNow()) return
      // A running reaction owns the pet: a tap must not cut it short, and must
      // not start a second reaction over it. Every reaction producer (the feed
      // button, a one-shot menu button) takes one of these locks, so the tap
      // path only has to honour them.
      const now = Date.now()
      if (
        now < feedLockUntilRef.current
        || now < oneShotLockUntilRef.current
        || now < workBeatLockRef.current
      ) return
      // Any non-work mode ends on a tap (sleep wakes up, a bath steps out);
      // work keeps swallowing taps while its round is running.
      if (modeRef.current !== null && modeRef.current !== 'work') {
        void api.setMode(null).then(applyResult, () => undefined)
        return
      }
      if (modeRef.current === 'work') return
      const box = def.hitBox ?? { x0: 0, y0: 0, x1: 1, y1: 1 }
      const hx = (fx - box.x0) / (box.x1 - box.x0)
      const hy = (fy - box.y0) / (box.y1 - box.y0)
      if (hx < 0 || hx > 1 || hy < 0 || hy > 1) return
      if (Date.now() < touchLockUntilRef.current) {
        void api.touch().then(applyResult, () => undefined)
        return
      }
      const activeSkin = definition.frames2d?.skins?.find(skin => skin.id === skinIdRef.current)
      if (activeSkin !== undefined) {
        // Skin click actions roll first (declared order, cumulative
        // probabilities); on a hit play the action's track once. A miss
        // stays on the plain click boost — never the default touch zones.
        const actions = activeSkin.clickActions ?? []
        if (actions.length > 0) {
          let roll = Math.random()
          const fired = actions.find(action => {
            if (roll < action.probability) return true
            roll -= action.probability
            return false
          })
          if (fired !== undefined) {
            holdTrack(fired.track, trackDuration(fired.track) || 3000)
            speak(fired.phrases)
            return
          }
        }
        void api.touch().then(applyResult, () => undefined)
        return
      }
      const zone = def.touch === undefined ? undefined : touchZoneAt(def.touch, hy)
      if (zone === undefined) return
      void api.touch(zone.name).then((result) => {
        applyResult(result)
        if (result.hit !== true) return
        if (result.state !== undefined) holdTrack(result.state, result.stateMs ?? 3000)
        if (result.phrase !== undefined) {
          store.actions.setFeedback({ text: result.phrase, kind: 'none', at: Date.now() })
        }
      }, () => undefined)
    }
    return () => { bus.tap = undefined }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one registration per pet definition
  }, [definition.id, def])

  // Panel feed/pet button: the hover panel's action row is chrome, so its
  // click arrives here through the bus instead of the apply body's injected
  // action. Three rules make the animation behave:
  //   1. cooldown — the interaction result's `accepted` flag decides whether a
  //      reaction plays at all, so a click refused by the host cooldown speaks
  //      its bubble without restarting the eat animation for nothing;
  //   2. interruption lock — a click during a running reaction is dropped, and
  //      the tap handler above refuses to cut it short;
  //   3. single flight — `feedBusyRef` swallows double clicks that arrive
  //      before the host has answered the first one.
  // A pet that declares no `gameplay.feed` keeps the old behaviour (bubble
  // only): the chrome falls back to its injected action when this is absent,
  // but the HUD still answers the click so the feedback bubble is never lost.
  useEffect(() => {
    if (def === undefined) return undefined
    const feed = (kind: PetInteraction): void => {
      if (feedBusyRef.current) return
      if (Date.now() < feedLockUntilRef.current) return
      // Feeding plays the eat animation, which steals the sprite from the work
      // loop: the same reason a purchase is refused while the agent works. The
      // panel button lives in the chrome and cannot be greyed from here, so the
      // click answers with the busy line instead of doing nothing.
      if (kind === 'feed' && refuseWhileBlocked()) return
      // A work beat (the walk to the desk, the wrap-up, the cut-short beat) owns
      // the sprite until its own hold ends. Taking the track away here cut the
      // wrap-up in half whenever the player clicked feed while it played.
      if (kind === 'feed' && Date.now() < workBeatLockRef.current) {
        pushFloat(tr('pet.gameplay.busy'))
        return
      }
      feedBusyRef.current = true
      void api.interact(kind)
        .then((result) => {
          feedBusyRef.current = false
          store.actions.setFeedback({ text: result.reaction, kind, at: Date.now() })
          if (kind !== 'feed' || result.accepted !== true) return
          const cfg = def.feed
          if (cfg === undefined) return
          // The host rolls the `states` pool and reports the pick, because the
          // same roll also chose the bubble line above — rolling again here
          // would put a "thanks for the food" line over a basin flip. The local
          // pick only covers a host that reports no state.
          const picked = result.state ?? pickFeedTrack(cfg)
          if (picked === undefined) return
          // Only play art the manifest actually declares: a track with no
          // frames would silently show the idle loop, which reads as a bug.
          const declared = definition.frames2d?.tracks[picked]
          if (declared === undefined) return
          // A non-looping track ends on its own fallback, so holding the full
          // loop of a looping track would be wrong: fall back to a fixed
          // window unless the manifest asks for longer.
          const hold = cfg.holdMs ?? (declared.loop === false ? (trackDuration(picked) + TRACK_HOLD_GRACE_MS) : 2000)
          holdLockedTrack(picked, hold, feedLockUntilRef)
        }, () => { feedBusyRef.current = false })
    }
    bus.feed = feed
    return () => {
      bus.feed = undefined
      feedBusyRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one registration per pet definition
  }, [definition.id, def])

  // Panel entry (chrome -> HUD): the hover panel's 玩法 button drives the
  // card through this channel so the chrome never needs the card's state.
  useEffect(() => {
    bus.openCard = (next?: boolean) => {
      setOpen(prev => next ?? !prev)
      setPage('root')
    }
    return () => { bus.openCard = undefined }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one registration per bus
  }, [bus])

  // Card placement: the card must not enter the bubble band above the sprite
  // or the hover-panel band below it, so it opens beside the sprite instead
  // of growing upward from the pet's feet. It is vertically centered on the
  // sprite box, clamped to the sprite's height, and the side is chosen by
  // the space available to each side (right first; a pet parked near the
  // right viewport edge flips the card to the left).
  useLayoutEffect(() => {
    if (!open) return undefined
    const hud = hudRef.current
    const card = cardRef.current
    if (hud === null || card === null) return undefined
    const place = (): void => {
      const box = hud.parentElement?.getBoundingClientRect()
      if (box === undefined) return
      const gap = 8
      const width = card.getBoundingClientRect().width
      const toRight = window.innerWidth - box.right
      const x = toRight >= width + gap ? box.width + gap : -(width + gap)
      card.style.transform = 'translate(' + Math.round(x) + 'px, ' + Math.round(-box.height / 2) + 'px) translateY(50%)'
      card.style.maxHeight = Math.round(box.height) + 'px'
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one placement per open/page change
  }, [open, page])

  // Drag gestures end any non-work mode (sleep wakes, a bath steps out); the
  // drag stream also feeds the idle director's suppression check.
  useEffect(() => {
    return props.drag.subscribe((dragging) => {
      draggingRef.current = dragging
      if (dragging) yieldRoam()
      if (dragging && modeRef.current !== null && modeRef.current !== 'work') {
        void api.setMode(null).then(applyResult, () => undefined)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one subscription per drag stream
  }, [props.drag])

  // Idle director: weighted rolls between staying idle and playing an act.
  // Rolls in every phase -- an ambient act is not a waiting-room performance,
  // and the idle phase only appears when neither the agent nor the user is busy
  // -- but only while nothing else owns the visual: no mode, no drag, no held
  // touch animation, no roam walk and no act already playing. maxMiss forces an
  // act after too many idle rolls in a row.
  useEffect(() => {
    const director = def?.idleDirector
    if (def === undefined || director === undefined) return undefined
    const total = director.idleWeight + director.acts.reduce((sum, act) => sum + act.weight, 0)
    if (total <= 0) return undefined
    let actTimer = 0
    const timer = window.setInterval(() => {
      if (modeRef.current !== null || draggingRef.current) return
      if (Date.now() < touchLockUntilRef.current) return
      if (roamHeldRef.current) return // a roam walk owns the visual
      if (actHeldRef.current) return // the previous act is still playing
      let pickedAct: { track: string; weight: number; phrases?: string[] } | undefined
      if (missRef.current >= director.maxMiss) {
        // Forced act: pick among the acts only.
        const actTotal = director.acts.reduce((sum, act) => sum + act.weight, 0)
        let actRoll = Math.random() * actTotal
        for (const act of director.acts) {
          actRoll -= act.weight
          if (actRoll < 0) { pickedAct = act; break }
        }
      } else {
        let roll = Math.random() * total
        for (const act of director.acts) {
          roll -= act.weight
          if (roll < 0) { pickedAct = act; break }
        }
      }
      if (pickedAct === undefined) {
        missRef.current += 1
        return
      }
      missRef.current = 0
      actHeldRef.current = true
      bus.setTrack?.(pickedAct.track)
      // A one-shot act owns the visual until its own duration elapses (the
      // renderer then falls back to the phase map); the roam must not cut in.
      const holdMs = definition.frames2d?.tracks[pickedAct.track]?.durations.reduce((sum, ms) => sum + ms, 0) ?? 0
      window.clearTimeout(actTimer)
      actTimer = window.setTimeout(() => { actHeldRef.current = false }, holdMs > 0 ? holdMs : 3000)
      // Acts with a phrase pool speak one line while they play (miku parity).
      if (pickedAct.phrases !== undefined && pickedAct.phrases.length > 0) {
        const phrase = pickedAct.phrases[Math.floor(Math.random() * pickedAct.phrases.length)]!
        store.actions.setFeedback({ text: phrase, kind: 'none', at: Date.now() })
      }
    }, director.intervalMs)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(actTimer)
      actHeldRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one director per pet definition
  }, [definition.id, def])

  // Work loop: hold the work track, adjudicate one round per tick, play the
  // result track for its hold window, then resume. Leaving the mode
  // releases the override so the phase mapping takes over. A skin that
  // declares gameplayTracks for the work states plays its own art instead.
  useEffect(() => {
    const work = def?.work
    if (def === undefined || work === undefined || view?.mode !== 'work') return undefined
    const skinGameplay = definition.frames2d?.skins?.find(skin => skin.id === skinIdRef.current)?.gameplayTracks
    /** The state's track, swapped for the skin's override when it declares one. */
    const trackOf = (state: string): string => skinGameplay?.[state] ?? state
    bus.setTrack?.(trackOf(work.state))
    let resultTimer = 0
    const timer = window.setInterval(() => {
      if (busyRef.current) return
      busyRef.current = true
      void api.workTick().then((result) => {
        busyRef.current = false
        // Leaving work mode while the adjudication is in flight drops the late
        // result: writing it back would show work rewards and play the result
        // track for a mode the user has already left (#1495).
        if (modeRef.current !== 'work') return
        applyResult(result)
        if (result.ok !== true || result.outcome === undefined) return
        const resultTrack = trackOf(result.outcome === 'success' ? work.successState : work.failState)
        const hold = result.outcome === 'success' ? work.resultMs?.success ?? 1300 : work.resultMs?.fail ?? 1900
        bus.setTrack?.(resultTrack)
        resultTimer = window.setTimeout(() => {
          if (modeRef.current === 'work') bus.setTrack?.(trackOf(work.state))
        }, hold)
      }, () => { busyRef.current = false })
    }, work.tickMs)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(resultTimer)
      bus.setTrack?.(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the loop keys on the mode and the selected skin
  }, [definition.id, def, view?.mode, skinId])

  // Mode loop: hold the active non-work mode's track (sleep, a bath, any
  // extra 'modes' entry). The stat restore is host-side (lazy settle). While a
  // skin with a matching gameplayTracks override is selected, the skin's own
  // track replaces the default one (e.g. a skin-specific doze).
  useEffect(() => {
    const active = view?.mode
    if (def === undefined || active === undefined || active === null || active === 'work') return undefined
    const hold = modeStateOf(def, active)
    if (hold === undefined) return undefined
    const skinGameplay = definition.frames2d?.skins?.find(skin => skin.id === skinIdRef.current)?.gameplayTracks
    yieldRoam()
    bus.setTrack?.(skinGameplay?.[active] ?? hold)
    return () => bus.setTrack?.(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the loop keys on the mode value
  }, [definition.id, def, view?.mode, skinId])

  // Random roaming (manifest 'roam'): on a slow interval -- in any phase, as long
  // as no mode, drag, touch animation or director act owns the pet -- roll a
  // wander. The chrome walks the sprite and persists the new spot; this side
  // holds the walk track for exactly the travel time.
  useEffect(() => {
    const roam = def?.roam
    if (def === undefined || roam === undefined) return undefined
    const roll = (): void => {
      // Every phase: a wandering pet is ambient, not a performance, so she
      // keeps walking while the agent works (the idle director's acts stay
      // idle-only). A mode, a drag, a touch animation and a director
      // act all still own the pet and suppress the roll.
      if (modeRef.current !== null || draggingRef.current) return
      if (Date.now() < touchLockUntilRef.current) return
      if (roamHeldRef.current || actHeldRef.current) return
      if (Math.random() >= roam.probability) return
      const span = roam.distanceMax - roam.distanceMin
      const distance = roam.distanceMin + Math.random() * span
      const directions = roam.directions ?? PET_ROAM_DIRECTIONS
      const direction = directions[Math.floor(Math.random() * directions.length)] ?? 'left'
      const travelled = bus.walk?.(direction, distance, roam.speed) ?? 0
      if (travelled === 0) return
      roamHeldRef.current = true
      bus.setTrack?.(roam.state)
      roamTimerRef.current = window.setTimeout(() => {
        roamTimerRef.current = 0
        if (!roamHeldRef.current) return // another owner already took the slot
        roamHeldRef.current = false
        bus.setTrack?.(undefined)
      }, Math.max(150, (Math.abs(travelled) / roam.speed) * 1000))
    }
    // The two decision timers must never share a tick. The roam starts half an
    // interval late, so its ticks interleave with the idle director's instead
    // of landing on the same instant (10 s and 15 s coincide every 30 s).
    let timer = 0
    const lead = window.setTimeout(() => {
      roll()
      timer = window.setInterval(roll, roam.intervalMs)
    }, Math.round(roam.intervalMs / 2))
    return () => {
      window.clearTimeout(lead)
      window.clearInterval(timer)
      yieldRoam()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one director per pet definition
  }, [definition.id, def])

  if (def === undefined || view === undefined) return null

  const mode = view.mode
  const stats = def.stats ?? {}
  const shop = def.shop

  // Every menu mode beyond work: sleep plus any extra 'modes' the pet declares.
  const menuModes = declaredModes(def)

  /** Action-button label for one mode (active = the button that leaves it). */
  const modeLabel = (name: string, active: boolean): string => {
    if (name === 'sleep') return tr(active ? 'pet.gameplay.wake' : 'pet.gameplay.sleep')
    const declared = def?.modes?.[name]
    // A one-shot mode is never "entered", so its button never flips to the
    // exit label — only a held mode does.
    if (active && declared?.once !== true) return declared?.activeLabel ?? declared?.label ?? tr('pet.gameplay.' + name)
    return declared?.label ?? tr('pet.gameplay.' + name)
  }

  /** Chip label for the mode the pet is in right now. */
  const modeChip = (name: string): string => {
    if (name === 'work') return tr('pet.gameplay.working')
    if (name === 'sleep') return tr('pet.gameplay.sleeping')
    const declared = def.modes?.[name]
    return declared?.activeLabel ?? declared?.label ?? tr('pet.gameplay.' + name)
  }

  const buy = (itemId: string): void => {
    // Single flight: a purchase is consumed immediately (there is no inventory),
    // so a second click while the answer is still owed would spend the player's
    // treats twice for one item.
    if (refuseWhileBlocked()) return
    if (buyBusyRef.current) return
    buyBusyRef.current = true
    void api.buy(itemId).then((result) => {
      buyBusyRef.current = false
      applyResult(result)
      if (result.ok !== true) {
        if (result.error === 'insufficient-funds') {
          const item = shop?.items.find(entry => entry.id === itemId)
          pushFloat(tr('pet.gameplay.insufficient', { currency: currencyLabel(item?.currency ?? 'treats') }))
        } else if (result.error === 'blocked') {
          // The host refused: the turn started after this click left the panel.
          // Nothing was spent, so this is the honest report.
          pushFloat(tr('pet.gameplay.busy'))
        }
        return
      }
      if (result.prize !== undefined) {
        pushFloat(tr('pet.gameplay.prize', { amount: result.prize.amount, currency: currencyLabel(result.prize.currency) }))
      }
    }, () => { buyBusyRef.current = false })
  }

  const setMode = (next: string | null): void => {
    // The work lockout covers menu reactions too: a one-shot mode plays through
    // the same override slot the work animation holds, so it would cut the
    // working sprite in half. (Real modes — work/sleep — stay reachable: they
    // are how the player leaves the state this gate protects.)
    if (next !== null && isOneShotMode(def, next) && refuseWhileBlocked()) return
    // One-shot menu mode (a declared modes entry with once): the button is a
    // reaction, not a state — play its track for the declared hold, settle back
    // to idle, and never tell the host a mode started. Nothing needs exiting, so
    // the pet is pettable again the moment the animation ends.
    if (next !== null && def !== undefined && isOneShotMode(def, next)) {
      if (Date.now() < oneShotLockUntilRef.current) return
      const declared = definition.frames2d?.tracks[def.modes?.[next]?.state ?? '']
      // Never play art the pet does not ship: an undeclared or empty track
      // would leave the sprite on the idle loop, which reads as a broken button.
      const track = def.modes?.[next]?.state
      if (track === undefined || declared === undefined) return
      const hold = oneShotHoldMsOf(def, next) ?? (declared.loop === false ? (trackDuration(track) || 2000) : 2000)
      setRunningOnce(next)
      holdLockedTrack(track, hold, oneShotLockUntilRef)
      // Release the button only while THIS hold is still the current one: a
      // second play that starts after this timer was armed must not be cleared
      // by the older timer.
      const armedAt = oneShotLockUntilRef.current
      window.setTimeout(() => {
        if (oneShotLockUntilRef.current !== armedAt) return
        oneShotLockUntilRef.current = 0
        setRunningOnce(null)
      }, hold)
      return
    }
    void api.setMode(next).then(applyResult, () => undefined)
  }

  // Skin selection is persisted host-side (per pet): re-seed the menu from
  // every fresh state view, so a page reload or client restart keeps the last
  // choice instead of snapping back to the default look.
  useEffect(() => {
    setSkinId(persistedSkin)
  }, [definition.id, persistedSkin])

  // Push the resolved base idle track into the renderer whenever the pet or
  // the selection changes. The value is latched on the bus first: the visual
  // may register later, or remount later (hidden/summoned), and reads the
  // latch back on activation so a restored skin never falls back to default.
  useEffect(() => {
    const skin = definition.frames2d?.skins?.find(candidate => candidate.id === skinId)
    bus.idleTrack = skin?.idleTrack
    bus.setIdleTrack?.(skin?.idleTrack)
    // persistedSkin rides the deps so the host's value also re-pushes on
    // arrival (a renderer that mounted early still converges).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one push per selection
  }, [definition.id, skinId, persistedSkin])

  const skins = definition.frames2d?.skins
  /** The base idle track one skin id resolves to (undefined = default look). */
  const skinTrackOf = (id: string | undefined): string | undefined =>
    id === undefined ? undefined : definition.frames2d?.skins?.find(candidate => candidate.id === id)?.idleTrack

  const selectSkin = (skin: PetSkinDefinition | undefined): void => {
    // Same lockout as every other action: swapping the resting look mid-work
    // changes the sprite under the running animation.
    if (refuseWhileBlocked()) return
    setSkinId(skin?.id)
    bus.setIdleTrack?.(skin?.idleTrack)
    // The host owns the choice: a refusal (unknown skin) restores both the
    // menu highlight and the renderer to the value it still serves.
    const restore = (): void => {
      setSkinId(persistedSkin)
      bus.setIdleTrack?.(skinTrackOf(persistedSkin))
    }
    void api.setSkin(skin?.id).then((result) => {
      if (result.ok) return
      restore()
    }, restore)
  }

  return (
    <div ref={hudRef} className={styles.gameplayHud} data-dsh-pet-gameplay={definition.id}>
      {floats.map(entry => (
        <div key={entry.id} className={styles.gameplayFloat}>{entry.text}</div>
      ))}
      {mode !== null && !(def !== undefined && isOneShotMode(def, mode)) && (
        <div className={styles.gameplayModeChip}>
          {modeChip(mode)}
        </div>
      )}
      {open && (
        <div ref={cardRef} className={styles.gameplayCard} data-page={page}>
          {page === 'root' && (
            <>
              <div className={styles.gameplayBars}>
                {Object.entries(stats).map(([name, stat]) => {
                  const value = view.stats[name] ?? 0
                  return (
                    <div key={name} className={styles.gameplayBarRow} title={statLabel(name) + ' ' + String(value) + '/' + String(stat.max)}>
                      <span className={styles.gameplayBarLabel}>{statLabel(name)}</span>
                      <span className={styles.gameplayBarTrack}>
                        <span
                          className={styles.gameplayBarFill}
                          style={{ width: Math.round((value / stat.max) * 100) + '%' }}
                        />
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className={styles.gameplayActions}>
                {menuModes.map(name => (
                  <button
                    key={name}
                    type="button"
                    className={actionClass(styles.action)}
                    // A one-shot mode plays and settles; disable its button for
                    // the duration so the reaction cannot be restarted mid-play
                    // (the lock in setMode is the authority, this is the affordance).
                    disabled={runningOnce === name}
                    aria-disabled={blocked}
                    title={blockedTitle()}
                    onClick={() => setMode(mode === name ? null : name)}
                  >
                    {modeLabel(name, mode === name)}
                  </button>
                ))}
                {shop !== undefined && (
                  <button
                    type="button"
                    className={actionClass(styles.action)}
                    aria-disabled={blocked}
                    title={blockedTitle()}
                    onClick={() => { if (!refuseWhileBlocked()) setPage('shop') }}
                  >
                    {tr('pet.gameplay.shop')}
                  </button>
                )}
                {skins !== undefined && skins.length > 0 && (
                  <button
                    type="button"
                    className={actionClass(styles.action)}
                    aria-disabled={blocked}
                    title={blockedTitle()}
                    onClick={() => { if (!refuseWhileBlocked()) setPage('skins') }}
                  >
                    {tr('pet.gameplay.skin')}
                  </button>
                )}
                {def.work !== undefined && (
                  // ★ Work stays reachable on purpose: it is the state this
                  // gate protects, so refusing the button that leaves it would
                  // strand the player behind a grayed panel.
                  <button
                    type="button"
                    className={styles.action}
                    onClick={() => setMode(mode === 'work' ? null : 'work')}
                  >
                    {tr(mode === 'work' ? 'pet.gameplay.stopWork' : 'pet.gameplay.work')}
                  </button>
                )}
              </div>
            </>
          )}
          {page === 'shop' && shop !== undefined && (
            <>
              <div className={styles.gameplayShopItems}>
                {shop.items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className={actionClass(styles.gameplayShopItem)}
                    // While the agent owns the sprite the cell greys, but it
                    // stays clickable so the click can explain itself instead of
                    // doing nothing.
                    aria-disabled={blocked}
                    onClick={() => buy(item.id)}
                    title={blockedTitle(item.label + ' — ' + String(item.price) + ' ' + currencyLabel(item.currency))}
                  >
                    {item.image !== undefined && (
                      <img className={styles.gameplayShopItemImage} src={item.image} alt="" draggable={false} />
                    )}
                    <span className={styles.gameplayShopItemLabel}>{item.label}</span>
                    <span className={styles.gameplayShopItemPrice}>
                      {item.price} {currencyLabel(item.currency)}
                    </span>
                  </button>
                ))}
              </div>
              <div className={styles.gameplayActions}>
                <button
                  type="button"
                  className={actionClass(styles.action)}
                  aria-disabled={blocked}
                  title={blockedTitle()}
                  onClick={() => setPage('root')}
                >
                  {tr('pet.gameplay.back')}
                </button>
              </div>
            </>
          )}
          {page === 'skins' && skins !== undefined && (
            <>
              <div className={styles.gameplaySkinItems}>
                <button
                  type="button"
                  className={actionClass(skinId === undefined ? styles.gameplaySkinItem + ' ' + styles.gameplaySkinItemActive : styles.gameplaySkinItem)}
                  aria-disabled={blocked}
                  title={blockedTitle()}
                  onClick={() => selectSkin(undefined)}
                >
                  {tr('pet.gameplay.skinDefault')}
                </button>
                {skins.map(skin => (
                  <button
                    key={skin.id}
                    type="button"
                    className={actionClass(skinId === skin.id ? styles.gameplaySkinItem + ' ' + styles.gameplaySkinItemActive : styles.gameplaySkinItem)}
                    aria-disabled={blocked}
                    title={blockedTitle()}
                    onClick={() => selectSkin(skin)}
                  >
                    {skin.label}
                  </button>
                ))}
              </div>
              <div className={styles.gameplayActions}>
                <button
                  type="button"
                  className={actionClass(styles.action)}
                  aria-disabled={blocked}
                  title={blockedTitle()}
                  onClick={() => setPage('root')}
                >
                  {tr('pet.gameplay.back')}
                </button>
              </div>
            </>
          )}
          <button
            type="button"
            className={styles.gameplayClose}
            aria-label={tr('pet.gameplay.back')}
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
