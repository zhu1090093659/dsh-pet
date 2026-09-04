import { describe, expect, it } from 'vitest'
import type { PetTrackDef } from '../registry.ts'
import type { PetAnimation } from '../state.ts'
import { createSequenceTimeline, sequenceFrameAt } from './sequences.ts'

const track = (durations: number[]): PetTrackDef => ({
  frames: durations.map((_, index) => index),
  durations,
  loop: true,
})

const tracks = {
  running: track([100, 200]),
  waiting: track([300, 100]),
} as Record<PetAnimation, PetTrackDef>

describe('sequenceFrameAt', () => {
  const sequence: PetAnimation[] = ['running', 'waiting']

  it('finishes every frame of one track before advancing', () => {
    expect(sequenceFrameAt(sequence, tracks, 0)).toEqual({ animation: 'running', frameIndex: 0 })
    expect(sequenceFrameAt(sequence, tracks, 100)).toEqual({ animation: 'running', frameIndex: 1 })
    expect(sequenceFrameAt(sequence, tracks, 299)).toEqual({ animation: 'running', frameIndex: 1 })
    expect(sequenceFrameAt(sequence, tracks, 300)).toEqual({ animation: 'waiting', frameIndex: 0 })
    expect(sequenceFrameAt(sequence, tracks, 600)).toEqual({ animation: 'waiting', frameIndex: 1 })
  })

  it('loops the whole sequence and preserves overshoot', () => {
    expect(sequenceFrameAt(sequence, tracks, 700)).toEqual({ animation: 'running', frameIndex: 0 })
    expect(sequenceFrameAt(sequence, tracks, 850)).toEqual({ animation: 'running', frameIndex: 1 })
    expect(sequenceFrameAt(sequence, tracks, 1_420)).toEqual({ animation: 'running', frameIndex: 0 })
  })
})

describe('createSequenceTimeline', () => {
  const sequence: PetAnimation[] = ['running', 'waiting']

  it('resolves identically to the per-call helper at animation-sample elapsed values', () => {
    // The sprite frame loop asks once per rAF tick with accumulated
    // millisecond offsets; the precomputed table must agree everywhere.
    const timeline = createSequenceTimeline(sequence, tracks)
    for (let elapsed = 0; elapsed <= 1_500; elapsed += 7) {
      expect(timeline.frameAt(elapsed)).toEqual(sequenceFrameAt(sequence, tracks, elapsed))
    }
  })

  it('stays deterministic across repeated queries with the same table', () => {
    const timeline = createSequenceTimeline(sequence, tracks)
    expect(timeline.frameAt(350)).toEqual(timeline.frameAt(350))
    expect(timeline.frameAt(0)).toEqual({ animation: 'running', frameIndex: 0 })
    expect(timeline.frameAt(1_420)).toEqual({ animation: 'running', frameIndex: 0 })
  })
})
