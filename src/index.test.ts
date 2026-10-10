import { describe, expect, it } from 'vitest'
import { Config, PET_FORM_DEFAULTS, petSettingsSection, type PetFormConfig } from './index.ts'

/** Resolve one config as plain values: volatile fields resolve to live references. */
function plain(config: ReturnType<typeof Config>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).map(([field, value]) => {
    const ref = value as { get?: () => unknown }
    return [field, typeof ref.get === 'function' ? ref.get() : value]
  }))
}

/** The write hook the Loader uses to commit a value into a live config reference. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** Commit a value the way the Loader's volatile update does. */
function commitLive(reference: unknown, value: unknown): void {
  const write = (reference as Record<symbol, ((next: unknown) => void) | undefined>)[VOLATILE_WRITE]
  if (write === undefined) throw new Error('the config field is not a live reference')
  write(value)
}

describe('pet configuration schema', () => {
  it('operator gets the pet selection and display defaults from an entry config that sets nothing', () => {
    // Given a profile entry that declares no pet settings at all
    // When the Host resolves the plugin's own Config schema
    const resolved = plain(Config({}))
    // Then every field the settings page edits carries its documented default
    expect(resolved).toMatchObject({
      visible: true,
      size: 160,
      right: 24,
      bottom: 20,
      bubbleScale: 1,
      physics: false,
      enabled: true,
      decorationEnabled: true,
      statusBubbles: 'auto',
    })
  })

  it('operator keeps a stale pet selection instead of failing config validation', () => {
    // Given a stored selection naming a pet the registry no longer has
    // When the entry config is resolved against the schema
    const resolved = Config({ petId: 'dragon' })
    // Then the selection survives (the service clamps it against the registry)
    expect(resolved.petId.get()).toBe('dragon')
  })

  it('user keeps the saved pet after restart when the profile never selected one', () => {
    // Given a persisted maid whale and no profile-level pet choice
    const resolved = Config({})
    // When the plugin starts and resolves its active settings
    const section = petSettingsSection(resolved, 'jyn')
    // Then the persisted pet survives instead of being reset to the schema default
    expect(section.petId).toBe('jyn')
  })

  it('operator edits every page field through a Host-served config path', () => {
    // Given the Host serves only the volatile fields of a plugin's Config
    // When the pet's schema is inspected field by field
    const volatile = Object.fromEntries(
      Object.entries(Config.dict ?? {}).map(([field, fieldSchema]) => [field, fieldSchema.meta.volatile === true]),
    )
    // Then every field the settings card renders is a volatile one
    expect(volatile).toEqual({
      visible: true,
      size: true,
      right: true,
      bottom: true,
      bubbleScale: true,
      physics: true,
      petId: true,
      enabled: true,
      decorationEnabled: true,
      statusBubbles: true,
    })
  })
})

describe('petSettingsSection', () => {
  it('user runs the pet on the settings the Host committed into the live config', () => {
    // Given a running row whose config references carry the edited values
    const config = {
      size: { get: () => 240 },
      visible: { get: () => false },
      petId: { get: () => 'doro' },
    } as unknown as PetFormConfig
    // When the plugin resolves the settings section it runs with
    const section = petSettingsSection(config, 'whale-girl')
    // Then the edited fields win and the untouched ones resolve to their defaults
    expect(section).toEqual({
      visible: false,
      size: 240,
      right: 24,
      bottom: 20,
      bubbleScale: 1,
      physics: false,
      petId: 'doro',
      enabled: true,
      decorationEnabled: true,
      statusBubbles: 'auto',
    })
  })

  it('user edits a served field and the running pet reads the committed value', () => {
    // Given a resolved config whose volatile fields are live references
    const resolved = Config({})
    const before = petSettingsSection(resolved, 'whale-girl')

    // When the Host commits an edited size the way the Loader does
    commitLive(resolved.size, 260)

    // Then the same activation reads the edit, while the earlier read stays a snapshot
    expect(petSettingsSection(resolved, 'whale-girl').size).toBe(260)
    expect(before.size).toBe(160)
  })

  it('user switches the pet\'s own bubbles off from the settings page (#6)', () => {
    // Given a resolved config whose user turned the status bubbles off
    const resolved = Config({ statusBubbles: 'off' })
    // When the plugin resolves the settings section it runs with
    const section = petSettingsSection(resolved, 'whale-girl')
    // Then the running pet is told to render no built-in bubbles
    expect(section.statusBubbles).toBe('off')
    // And the edit lands in the running activation, not only in the document
    commitLive(resolved.statusBubbles, 'off')
    expect(petSettingsSection(resolved, 'whale-girl').statusBubbles).toBe('off')
  })

  it('user keeps the status bubbles when the document carries no choice', () => {
    // Given a mount outside a Loader, where no schema default was applied
    const section = petSettingsSection({}, 'whale-girl')
    // Then the shipped behavior stands rather than the bubbles silently vanishing
    expect(section.statusBubbles).toBe('auto')
  })

  it('user keeps the pet selection it already has when the config names none', () => {
    // Given a mount whose config carries no pet selection
    // When the plugin resolves the settings section it runs with
    const section = petSettingsSection({}, 'doro')
    // Then the selection the pet already has stands
    expect(section.petId).toBe('doro')
  })
})

describe('petSettingsSection display persistence', () => {
  /** The layout a user dragged the pet to, as its own pet.json holds it. */
  const dragged = { visible: true, size: 160, right: 1428, bottom: 167, bubbleScale: 1 }

  it('user keeps the dragged position when the profile never committed one', () => {
    // Given a pet.json holding the layout the pet was dragged to
    // And a row config that never set the display fields, so they read back as
    // the schema defaults (the bottom-right corner)
    // When the plugin starts and resolves its active settings
    const section = petSettingsSection(Config({}), 'ouo-neko', dragged)
    // Then the dragged layout stands instead of snapping back to those defaults
    expect(section).toMatchObject({ right: 1428, bottom: 167 })
  })

  it('user commits a display field and the profile value outranks the persisted one', () => {
    // Given a dragged layout and a profile layer that committed a right inset
    const section = petSettingsSection(Config({}), 'ouo-neko', dragged, { right: 48 })
    // Then the explicit choice wins and the untouched field keeps the dragged one
    expect(section).toMatchObject({ right: 48, bottom: 167 })
  })

  it('user commits the schema default and the choice is not mistaken for unset', () => {
    // Given a dragged layout and a profile layer that committed the default inset
    const section = petSettingsSection(Config({}), 'ouo-neko', dragged, { right: 24 })
    // Then the explicit (default-valued) choice stands over the persisted one
    expect(section.right).toBe(24)
  })

  it('user commits a layout at runtime and the result outranks the persisted one', () => {
    // Given a live reference the Host committed into the running config
    const resolved = Config({})
    commitLive(resolved.right, 500)
    // When the plugin resolves the section against an older persisted layout
    const section = petSettingsSection(resolved, 'ouo-neko', dragged)
    // Then the live commit wins and the persisted value fills the other fields
    expect(section).toMatchObject({ right: 500, bottom: 167 })
  })
})
