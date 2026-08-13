/**
 * Local slot-table augmentation for slots the official NPM SDK
 * (ui-conversation rc.6) does not publish yet, but the running dsh worktree
 * boots with (`conversation.input.selector.*`). Type-only supplement — the
 * runtime surface comes from the dsh profile. Module form (with an import)
 * so TS merges into the package declarations instead of shadowing them.
 * Remove once the SDK ships these slots.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The input selector context-chip hole: feature chips rendered right
     * after the workspace selector. Session-maybe: entries stay mounted
     * without a session and hide themselves when their data source is absent.
     */
    'conversation.input.selector.context': {
      kind: 'list'
      scope: 'session-maybe'
      owner: InputSelectorContextOwnerProps
    }
  }

  /** Owner share of the input selector context-chip hole (empty by contract). */
  interface InputSelectorContextOwnerProps {}
}
