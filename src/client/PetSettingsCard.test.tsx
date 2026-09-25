// @vitest-environment jsdom
/**
 * The pet settings card under the aggregate shell, which serves no Host
 * settings form for the 'pet' namespace: the pet choice and its visibility
 * switch both write through the pet API, so the pet can still be turned off
 * when the Host form is absent.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { PetSettingsCard, PetSettingsCardController, type PetSettings } from './PetSettingsCard.tsx'
import { t } from './locales.ts'

vi.mock('@deepseek-ai/dsh-client-store', () => ({ // test-standards-allow: the SDK client bundle is a browser module factory and cannot be imported by Vitest
  createSnapshotStore: (initial: unknown) => {
    let value = initial
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      set: (next: unknown) => { value = next; for (const listener of listeners) listener() },
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
  },
}))

function unavailableForm() {
  const mutate = vi.fn(async () => false)
  const scope = {
    getSnapshot: () => ({ status: 'unavailable', writable: true, value: undefined, base: undefined, user: undefined }),
    subscribe: () => () => {},
    mutate,
  } as unknown as ConfigForm<PetSettings>
  return { scope, mutate }
}

function response(value: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => value } as Response
}

beforeAll(() => {
  document.documentElement.lang = 'zh'
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('pet selection without a Host settings form', () => {
  it('user saves the selected pet through its persisted API and confirms the read-back', async () => {
    // Given the aggregate shell exposes no pet configuration form
    vi.useFakeTimers()
    const { scope, mutate } = unavailableForm()
    let selected = 'whale-girl'
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/pet/pets') return response([{ id: 'whale-girl', displayName: '鲸鱼娘' }, { id: 'jyn', displayName: '女仆鲸鱼娘' }])
      if (path === '/api/pet/state') return response({ pet: { id: selected } })
      if (path === '/api/pet/set-pet') {
        selected = JSON.parse(String(init?.body)).petId as string
        return response({ ok: true, petId: selected })
      }
      throw new Error('unexpected request: ' + path)
    })
    vi.stubGlobal('fetch', fetch)
    const controller = new PetSettingsCardController(scope)
    await vi.advanceTimersByTimeAsync(0)
    const face = controller.inject()
    const state = () => face.hooks.petSettingsCard.getSnapshot()

    // When the user chooses the maid whale and clicks Save
    expect(state()).toMatchObject({ petSelectionFallback: true, petId: { text: 'whale-girl' }, dirty: false })
    face.edit('petId', '')
    expect(state()).toMatchObject({ dirty: false, petId: { text: 'whale-girl' } })
    face.edit('petId', 'jyn')
    expect(state()).toMatchObject({ dirty: true, petId: { text: 'jyn' } })
    face.save()
    await vi.waitFor(() => { expect(state().saving).toBe(false) })

    // Then the pet service holds it, the draft clears, and the absent Host form is untouched
    expect(selected).toBe('jyn')
    expect(state()).toMatchObject({ dirty: false, failed: false, petId: { text: 'jyn' } })
    expect(mutate).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith('/api/pet/set-pet', expect.objectContaining({ body: JSON.stringify({ petId: 'jyn' }) }))
    controller.dispose()
  })

  it('user keeps the draft when the pet API refuses the selection', async () => {
    // Given the Host has no pet form and the pet API still serves its selection
    vi.useFakeTimers()
    const { scope } = unavailableForm()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/pet/pets') return response([{ id: 'whale-girl', displayName: '鲸鱼娘' }, { id: 'jyn', displayName: '女仆鲸鱼娘' }])
      if (path === '/api/pet/state') return response({ pet: { id: 'whale-girl' } })
      if (path === '/api/pet/set-pet') return response({ ok: false, error: 'unknown-pet' })
      throw new Error('unexpected request: ' + path)
    }))
    const controller = new PetSettingsCardController(scope)
    await vi.advanceTimersByTimeAsync(0)
    const face = controller.inject()
    // When the user saves a selection the pet API refuses
    face.edit('petId', 'jyn')
    face.save()
    await vi.waitFor(() => { expect(face.hooks.petSettingsCard.getSnapshot().saving).toBe(false) })
    // Then the choice remains staged and the failure is visible
    expect(face.hooks.petSettingsCard.getSnapshot()).toMatchObject({ dirty: true, failed: true, petId: { text: 'jyn' } })
    controller.dispose()
  })
})

describe('pet visibility without a Host settings form', () => {
  it('user turns the pet off through its persisted API and confirms the read-back', async () => {
    // Given the aggregate shell exposes no pet configuration form and the pet is showing
    vi.useFakeTimers()
    const { scope, mutate } = unavailableForm()
    let visible = true
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path === '/api/pet/pets') return response([{ id: 'whale-girl', displayName: '鲸鱼娘' }])
      if (path === '/api/pet/state') return response({ pet: { id: 'whale-girl' }, display: { visible } })
      if (path === '/api/pet/set-visible') {
        visible = JSON.parse(String(init?.body)).visible as boolean
        return response({ ok: true, display: { visible } })
      }
      throw new Error('unexpected request: ' + path)
    })
    vi.stubGlobal('fetch', fetch)
    const controller = new PetSettingsCardController(scope)
    await vi.advanceTimersByTimeAsync(0)
    const face = controller.inject()
    const state = () => face.hooks.petSettingsCard.getSnapshot()

    // When the user switches the pet off and clicks Save
    expect(state()).toMatchObject({ petSelectionFallback: true, visible: { text: 'true' }, dirty: false })
    face.edit('visible', 'false')
    expect(state()).toMatchObject({ dirty: true, visible: { text: 'false' } })
    face.save()
    await vi.waitFor(() => { expect(state().saving).toBe(false) })

    // Then the pet service holds it, the draft clears, and the absent Host form is untouched
    expect(visible).toBe(false)
    expect(state()).toMatchObject({ dirty: false, failed: false, visible: { text: 'false' } })
    expect(mutate).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith('/api/pet/set-visible', expect.objectContaining({ body: JSON.stringify({ visible: false }) }))
    controller.dispose()
  })

  it('user keeps the draft when the pet API refuses the visibility write', async () => {
    // Given the Host has no pet form and the pet API refuses visibility writes
    vi.useFakeTimers()
    const { scope } = unavailableForm()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/pet/pets') return response([{ id: 'whale-girl', displayName: '鲸鱼娘' }])
      if (path === '/api/pet/state') return response({ pet: { id: 'whale-girl' }, display: { visible: true } })
      if (path === '/api/pet/set-visible') return response({ ok: false }, false)
      throw new Error('unexpected request: ' + path)
    }))
    const controller = new PetSettingsCardController(scope)
    await vi.advanceTimersByTimeAsync(0)
    const face = controller.inject()
    // When the user saves a visibility the pet API refuses
    face.edit('visible', 'false')
    face.save()
    await vi.waitFor(() => { expect(face.hooks.petSettingsCard.getSnapshot().saving).toBe(false) })
    // Then the switch keeps the draft and the failure is visible
    expect(face.hooks.petSettingsCard.getSnapshot()).toMatchObject({ dirty: true, failed: true, visible: { text: 'false' } })
    controller.dispose()
  })
})

describe('pet settings card rendered without a Host settings form', () => {
  it('shows the visibility switch beside the pet choice and hides the Host-only fields', async () => {
    // Given the aggregate shell exposes no pet configuration form
    vi.useFakeTimers()
    const { scope } = unavailableForm()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/pet/pets') return response([{ id: 'whale-girl', displayName: '鲸鱼娘' }])
      if (path === '/api/pet/state') return response({ pet: { id: 'whale-girl' }, display: { visible: true } })
      throw new Error('unexpected request: ' + path)
    }))
    const controller = new PetSettingsCardController(scope)
    await vi.advanceTimersByTimeAsync(0)
    const face = controller.inject()
    const store = face.hooks.petSettingsCard

    // When the card renders
    render(
      <PetSettingsCard
        t={t}
        usePetSettingsCard={select => useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()))}
        save={face.save}
        discard={face.discard}
        edit={face.edit}
        resetField={face.resetField}
      />,
    )

    // Then the pet choice and the switch that turns the pet off are both on screen
    expect(screen.getByLabelText(t('settings.pet'))).toBeTruthy()
    expect(screen.getByLabelText(t('settings.visible'))).toBeTruthy()
    // ...while the fields only the absent Host form owns stay hidden
    expect(screen.queryByLabelText(t('settings.enabled'))).toBeNull()
    expect(screen.queryByLabelText(t('settings.size'))).toBeNull()
    controller.dispose()
  })
})
