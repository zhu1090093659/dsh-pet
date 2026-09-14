/** @vitest-environment jsdom */

/**
 * The pet settings section contract: the 'settings.section' wrapper mounts the
 * card as a first-level settings page. The card is always open, so the enabled
 * switch renders as an Inherit/On/Off select without any expansion interaction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore, type ComponentProps } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide the one value
// member the card chain needs.
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore: (init: unknown) => {
    let value = init
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      set: (next: unknown) => { value = next; for (const listener of listeners) listener() },
      update: (mutator: (draft: never) => void) => { mutator(value as never); for (const listener of listeners) listener() },
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
  },
}))
import { PetSettingsSection, PetSettingsCardController, type PetSettingsSectionProps, type PetSettings } from '../src/client/PetSettingsCard.tsx'
import { en } from '../src/client/locales.ts'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
    { id: 'whale-girl', displayName: '鲸鱼娘（原版）' },
    { id: 'whale-girl-refined', displayName: '鲸鱼娘（精致版）' },
  ]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** English translate stub (same shape the sibling settings-card tests use). */
const t: PetSettingsSectionProps['t'] = (key) => {
  return (en as Record<string, string>)[key] ?? key
}

/** Minimal in-memory scope backing the card controller. */
class FakeScope implements SettingsScope<PetSettings> {
  value: PetSettings
  base: PetSettings
  user: Partial<PetSettings> = {}
  writable = true
  private listeners = new Set<() => void>()
  set = vi.fn(async (field: string, value: unknown) => {
    (this.user as Record<string, unknown>)[field] = value
    this.reflect()
  })
  unset = vi.fn(async (field: string) => {
    delete (this.user as Record<string, unknown>)[field]
    this.reflect()
  })
  mutate = vi.fn(async () => {})
  constructor(value: PetSettings) {
    this.value = value
    this.base = value
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getSnapshot(): SettingsScopeSnapshot<PetSettings> {
    return {
      status: 'ready',
      writable: this.writable,
      value: this.value,
      base: this.base,
      user: this.user,
      revision: 1,
      mode: 'host',
    }
  }
  private reflect(): void {
    this.value = { ...this.base, ...this.user }
    for (const listener of this.listeners) listener()
  }
}

/** Bind the controller's face into the section's prop shape (mirrors the slot renderer). */
function sectionProps(scope: SettingsScope<PetSettings>) {
  const controller = new PetSettingsCardController(scope)
  const face = controller.inject()
  const { hooks, ...actions } = face
  const usePetSettingsCard = <S,>(selector: (snapshot: ReturnType<typeof hooks.petSettingsCard.getSnapshot>) => S) =>
    useSyncExternalStore(
      hooks.petSettingsCard.subscribe,
      () => selector(hooks.petSettingsCard.getSnapshot()),
    )
  return { t, usePetSettingsCard, ...actions } as unknown as ComponentProps<typeof PetSettingsSection>
}

describe('PetSettingsSection', () => {
  it('defers the first registry request until client plugin startup completes', async () => {
    const controller = new PetSettingsCardController(new FakeScope({}))

    expect(fetch).not.toHaveBeenCalled()
    await waitFor(() => { expect(fetch).toHaveBeenCalledWith('/api/pet/pets') })
    controller.dispose()
  })

  it('renders the pet settings card open as a first-level settings page', () => {
    render(<PetSettingsSection {...sectionProps(new FakeScope({}))} />)
    const enabled = screen.getByLabelText(/enable the pet/i)
    expect(enabled.id).toBe('settings-pet-enabled')
    fireEvent.click(enabled)
    const options = screen.getAllByRole('option').map(option => option.textContent)
    expect(options).toEqual(['Inherit', 'On', 'Off'])
  })

  it('renders every live registry entry in the existing pet selector', async () => {
    render(<PetSettingsSection {...sectionProps(new FakeScope({ petId: 'whale-girl' }))} />)

    await waitFor(() => {
      expect(screen.getByLabelText('Pet').textContent).toContain('鲸鱼娘（原版）')
    })
    fireEvent.click(screen.getByLabelText('Pet'))
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
      'Inherit',
      '鲸鱼娘（原版）',
      '鲸鱼娘（精致版）',
    ])
  })
})

describe('atlas image load retry mechanism', () => {
  it('retries upon image load failure and resolves imageReady when a retry succeeds', () => {
    vi.useFakeTimers()
    try {
      let imageReady = false
      const setImageReady = (ready: boolean) => { imageReady = ready }

      let attempt = 0
      const maxAttempts = 3
      let cancelled = false
      let retryTimer: ReturnType<typeof setTimeout> | undefined
      let activeImg: { onload: (() => void) | null; onerror: (() => void) | null; src: string } | null = null
      const createdImages: Array<{ onload: (() => void) | null; onerror: (() => void) | null; src: string }> = []

      const atlasUrl = 'https://example.com/spritesheet.webp'

      const loadAtlas = () => {
        const img = {
          onload: null as (() => void) | null,
          onerror: null as (() => void) | null,
          src: '',
        }
        activeImg = img
        createdImages.push(img)
        img.onload = () => {
          if (!cancelled) setImageReady(true)
        }
        img.onerror = () => {
          if (cancelled) return
          if (attempt < maxAttempts) {
            attempt += 1
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
            retryTimer = setTimeout(loadAtlas, delay)
          }
        }
        img.src = atlasUrl
      }

      loadAtlas()

      expect(createdImages).toHaveLength(1)
      expect(imageReady).toBe(false)

      // First attempt fails
      createdImages[0]!.onerror!()
      expect(imageReady).toBe(false)

      // Advance timer by 1000ms for first retry
      vi.advanceTimersByTime(1000)
      expect(createdImages).toHaveLength(2)

      // Second attempt succeeds
      createdImages[1]!.onload!()
      expect(imageReady).toBe(true)

      // Cleanup
      cancelled = true
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      const lastImg = activeImg as { onload: unknown; onerror: unknown } | null
      if (lastImg !== null) {
        lastImg.onload = null
        lastImg.onerror = null
      }

      expect(createdImages[1]!.onload).toBeNull()
      expect(createdImages[1]!.onerror).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

