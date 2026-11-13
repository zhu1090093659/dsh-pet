/**
 * Global floating pet entry. The pet is host-global (its state, display and
 * interactions live on '/api/pet/*' endpoints with no session dimension), so
 * it must not ride a session-scoped slot — on the new-conversation screen no
 * session exists to scope a slot by, and the pet would vanish (issue #48).
 * The client half therefore mounts this entry straight onto 'document.body'
 * (see index.ts): while visible it renders the floating PetSprite (a portal
 * into the plugin root, so the root owns the whole surface), while hidden it
 * renders a fixed-position summon button. Which sprite renders is decided by
 * the host snapshot's pet id resolved against the registry list — no per-pet
 * component exists.
 * @module @linxin666/dsh-pet/client/PetDockEntry
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDisplayConfig } from '../persist.ts'
import type { PetStoreInstance } from './pet-store.ts'
import { PetSprite } from './PetSprite.tsx'
import { PetRendererSwitch } from './renderers/PetRendererSwitch.tsx'
import { createDragStream, type DragStream } from './drag-stream.ts'
import { GameplayHud, type GameplayApi, type GameplayBus } from './gameplay-hud.tsx'
import { NS } from './locales.ts'
import styles from './pet.module.css'

/** Injected actions handed to the dock entry component. */
export interface PetInjected {
  /** The app-wide pet store instance (snapshot + registry list + feedback). */
  store: PetStoreInstance
  /** Ensure the first snapshot (and registry list) is fetched (called on mount). */
  ensure: () => void
  /** Pet the sprite (click). */
  pet: () => void
  /** Feed the sprite. */
  feed: () => void
  /** Hide the sprite. */
  hide: () => void
  /** Summon the hidden sprite back. */
  summon: () => void
  /** Persist a drag position. */
  dragEnd: (right: number, bottom: number) => void
  /** Rename the selected pet (persisted by the host). */
  rename: (name: string) => void
  /**
   * Report a click on one plugin-registered panel action (issue #6). The host
   * dispatches it to the plugin that registered the action; the panel itself
   * only renders the button the state snapshot served.
   */
  panelAction: (id: string) => void
  /** Navigate the GUI to the session a bubble reports on. */
  openSession: (sessionId: string) => void
  /** Clear the reaction bubble. */
  feedbackDone: () => void
  /** Show a one-off line in the pet's bubble. */
  remark: (text: string) => void
  /** Gameplay verb API (miku-pet generalization); wired but unused for pets without a gameplay block. */
  gameplay: GameplayApi
}

/** Composed props of the global pet entry (locale + injected; no slot runtime share). */
export type PetDockEntryProps =
  PetInjected
  & PropsLocale<typeof NS>
  & {
    /**
     * DOM node the floating sprite chrome portals into. Defaults to
     * document.body; the plugin apply passes its [data-dsh-plugin="pet"]
     * root so root-keyed suppressors (the portrait mobile layer) and skins
     * own the whole pet surface as one unit.
     */
    portalTarget?: Element
    /**
     * Active UI locale id, forwarded to the sprite so a pet-declared English
     * rank name (`rankEn`) applies when the UI language is English.
     */
    lang?: string
  }

const DEFAULT_DISPLAY: PetDisplayConfig = { visible: true, size: 160, right: 24, bottom: 20, bubbleScale: 1 }

/**
 * Dock entry: while the pet is visible, mount the floating PetSprite (it
 * portals itself onto document.body); while hidden, render the summon
 * button so the pet can always come back. The store is the plugin-owned
 * single instance — the slot system provides none because the pet is
 * host-global, not session-scoped.
 */
export function PetDockEntry(props: PetDockEntryProps): ReactElement {
  const { store, ensure } = props
  const ui = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const snapshot = ui.snapshot
  const feedback = ui.feedback
  const definition = ui.pets.find(entry => entry.id === snapshot?.pet.id) ?? null
  const visible = snapshot?.display.visible ?? true

  useEffect(() => {
    ensure()
  }, [ensure])

  // Per-pet gameplay wiring: the coordination bus (HUD taps <-> chrome,
  // HUD track overrides <-> frames2d mount) and the shared drag stream.
  const auxRef = useRef<{ id: string; bus: GameplayBus; drag: DragStream } | null>(null)
  if (definition !== null && (auxRef.current === null || auxRef.current.id !== definition.id)) {
    auxRef.current = { id: definition.id, bus: {}, drag: createDragStream() }
  }
  const aux = auxRef.current
  const gameplay = definition?.gameplay
  // Live2d outfit selection: rendered optimistically (the world would otherwise
  // change only on the next poll tick), then reconciled with the host snapshot —
  // a rejected write falls back to the persisted choice.
  const persistedSkin = snapshot?.skin
  const [skin, setSkin] = useState<string | undefined>(persistedSkin)
  const skinPetRef = useRef<string | undefined>(definition?.id)
  useEffect(() => {
    if (skinPetRef.current !== definition?.id) {
      // A different pet carries its own persisted choice.
      skinPetRef.current = definition?.id
      setSkin(persistedSkin)
      return
    }
    // A poll that momentarily serves no skin must not clear the worn outfit:
    // the outfit only changes when the user picks one.
    if (persistedSkin !== undefined) setSkin(persistedSkin)
  }, [definition?.id, persistedSkin])
  const chooseSkin = (id: string | undefined): void => {
    setSkin(id)
    const lines = definition?.live2d?.skins?.find(candidate => candidate.id === id)?.switchLines
    if (lines !== undefined && lines.length > 0) {
      props.remark(lines[Math.floor(Math.random() * lines.length)]!)
    }
    void props.gameplay.setSkin(id).then((result) => {
      if (!result.ok) setSkin(persistedSkin)
    }, () => { setSkin(persistedSkin) })
  }

  // Idle chatter: while the pet has nothing to do she now and then says
  // something about her own life, picked from the voice pack's `life` pools.
  // The desktop category (a game, a video, an editor) tints the choice; a pool
  // that is missing falls back to `generic`.
  const lifeLines = definition?.lifeLines
  const desktopCategory = snapshot?.desktop?.category
  const phase = snapshot?.phase
  const nextChatAtRef = useRef<number>(Date.now() + 60_000 + Math.random() * 60_000)
  useEffect(() => {
    if (lifeLines === undefined) return
    const timer = setInterval(() => {
      if (Date.now() < nextChatAtRef.current) return
      if (phase !== 'idle' || !visible) return
      // Desktop buckets are finer than the chatter buckets: fold them down.
      const key = desktopCategory === 'game'
        ? 'game'
        : desktopCategory === 'video' || desktopCategory === 'music'
          ? 'video'
          : desktopCategory === 'editor' || desktopCategory === 'terminal' || desktopCategory === 'office'
            ? 'work'
            : undefined
      const hour = new Date().getHours()
      const lateNight = hour >= 23 || hour < 6
      const pool = (key === undefined ? undefined : lifeLines[key])
        ?? (lateNight ? lifeLines.late : undefined)
        ?? lifeLines.generic
      if (pool === undefined || pool.length === 0) {
        nextChatAtRef.current = Date.now() + 60_000
        return
      }
      props.remark(pool[Math.floor(Math.random() * pool.length)]!)
      nextChatAtRef.current = Date.now() + 90_000 + Math.random() * 120_000
    }, 10_000)
    return () => { clearInterval(timer) }
  }, [lifeLines, desktopCategory, phase, visible, props])

  if (visible) {
    return (
      <span data-pet-dock data-testid="pet-dock">
        {snapshot === null || definition === null
          ? null
          : (
            <PetRendererSwitch
              definition={definition}
              phase={snapshot?.phase ?? 'idle'}
              {...(skin === undefined ? {} : { skin })}
              onPet={props.pet}
              {...(aux === null ? {} : { drag: aux.drag, bus: aux.bus })}
              t={props.t}
            >
              <PetSprite
                snapshot={snapshot}
                definition={definition}
                display={snapshot.display}
                feedback={feedback}
                onPet={props.pet}
                onFeed={props.feed}
                onHide={props.hide}
                onDragEnd={props.dragEnd}
                onRename={props.rename}
                onPanelAction={props.panelAction}
                {...(skin === undefined ? {} : { skin })}
                {...(definition.live2d?.skins === undefined ? {} : { onSkin: chooseSkin })}
                onOpenSession={props.openSession}
                onFeedbackDone={props.feedbackDone}
                portalTarget={props.portalTarget}
                dragDisabled={snapshot.gameplay?.mode === 'work'}
                {...(aux === null ? {} : { bus: aux.bus })}
                lang={props.lang}
                {...(gameplay === undefined || aux === null
                  ? {}
                  : {
                      onGameplayTap: (fx: number, fy: number) => aux.bus.tap?.(fx, fy),
                      onGameplayMenu: () => aux.bus.openCard?.(),
                      hud: (
                        <GameplayHud
                          definition={definition}
                          store={store}
                          api={props.gameplay}
                          bus={aux.bus}
                          drag={aux.drag}
                          t={props.t}
                        />
                      ),
                    })}
                t={props.t}
              />
            </PetRendererSwitch>
          )}
      </span>
    )
  }
  const display = snapshot?.display ?? DEFAULT_DISPLAY
  return (
    <button
      type="button"
      className={styles.summon}
      style={{
        position: 'fixed',
        right: display.right,
        bottom: display.bottom,
        zIndex: 2147483000,
      }}
      onClick={props.summon}
      data-testid="pet-summon"
      data-dsh-part="summon-button"
    >
      {props.t('pet.summon', { name: snapshot?.name ?? '' })}
    </button>
  )
}
