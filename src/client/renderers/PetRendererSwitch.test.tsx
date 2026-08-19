// @vitest-environment jsdom
/**
 * PetRendererSwitch — the client dispatch seam (pet-center M2 P5, issue #623).
 * sprite2d hands through to the sprite; an unservable renderer gets a clear
 * diagnostic card instead of a blank pet.
 */
import { describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { afterEach } from 'vitest'
import { createElement } from 'react'
import { PetRendererSwitch } from './PetRendererSwitch.tsx'
import type { PetDefinition } from '../../registry.ts'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

function definition(renderer?: string): PetDefinition {
  return { id: 'x', displayName: 'X', description: '', renderer, cell: { width: 1, height: 1 }, columns: 8, rows: [], atlasRows: 9, tracks: {}, atlasUrl: '', manifestUrl: '' } as unknown as PetDefinition
}

const t = ((key: string, vars?: Record<string, string>) => key + (vars ? ' ' + JSON.stringify(vars) : '')) as unknown as PropsLocale<'pet'>['t']

describe('PetRendererSwitch', () => {
  afterEach(cleanup)
  it('hands sprite2d definitions straight to the sprite', () => {
    const { container } = render(createElement(PetRendererSwitch, { definition: definition('sprite2d'), t }, createElement('span', { 'data-testid': 'sprite' })))
    expect(container.querySelector('[data-testid="sprite"]')).toBeTruthy()
    expect(document.querySelector('[data-dsh-pet-renderer-fallback]')).toBeNull()
  })
  it('treats a missing renderer as sprite2d (pre-M2 data)', () => {
    const { container } = render(createElement(PetRendererSwitch, { definition: definition(undefined), t }, createElement('span', { 'data-testid': 'sprite' })))
    expect(container.querySelector('[data-testid="sprite"]')).toBeTruthy()
  })
  it('renders a diagnostic card for renderers this build cannot serve', () => {
    const { container } = render(createElement(PetRendererSwitch, { definition: definition('live2d'), t }, createElement('span', { 'data-testid': 'sprite' })))
    expect(container.querySelector('[data-testid="sprite"]')).toBeNull()
    const card = document.querySelector('[data-dsh-pet-renderer-fallback="live2d"]')
    expect(card?.textContent).toContain('live2d')
  })
})
