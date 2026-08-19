/**
 * Renderer switch — the client dispatch seam of the pet center (issue #623,
 * milestone M2 P5). The pet's manifest picks the renderer; today every listed
 * entry is sprite2d, so the switch hands straight through to the sprite. A
 * renderer the build cannot serve renders a clear diagnostic card instead of
 * blanking — and the dock, bubbles and panel around the pet stay untouched
 * (they belong to the pet center, not the renderer).
 * @module @linxin666/dsh-pet/client/renderers/PetRendererSwitch
 */

import type { ReactElement, ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDefinition } from '../../registry.ts'
import type { NS } from '../locales.ts'

/** Dispatch one pet definition to its renderer; unknown kinds get a card. */
export function PetRendererSwitch(props: {
  definition: PetDefinition
  t: PropsLocale<typeof NS>['t']
  children?: ReactNode
}): ReactElement {
  const renderer = props.definition.renderer ?? 'sprite2d'
  if (renderer === 'sprite2d') return <>{props.children}</>
  return (
    <span data-dsh-pet-renderer-fallback={renderer}>
      {props.t('pet.renderer.unavailable', { renderer })}
    </span>
  )
}
