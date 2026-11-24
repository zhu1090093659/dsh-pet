/**
 * Pet trust fence: loopback always passes; a live paired-device cookie is an
 * additional allow path when the remote-web-ui service is present.
 */
import type { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { isPetAllowed } from '../src/access.ts'

function request(options: {
  remoteAddress?: string
  host?: string
  cookie?: string
} = {}): IncomingMessage {
  return {
    headers: {
      host: options.host ?? '127.0.0.1:3000',
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
  } as IncomingMessage
}

describe('isPetAllowed', () => {
  it('allows loopback without a pairing service', () => {
    expect(isPetAllowed({} as never, request())).toBe(true)
  })

  it('refuses a LAN client when no pairing service is present', () => {
    const ctx = { get: () => undefined }
    expect(isPetAllowed(ctx as never, request({
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
    }))).toBe(false)
  })

  it('allows a LAN client with a live paired-device cookie', () => {
    const isPairedDevice = vi.fn(() => true)
    const ctx = { get: (name: string) => name === 'remoteWebUiPairing' ? { isPairedDevice } : undefined }
    const req = request({
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
      cookie: 'dsh_pair=dev-1',
    })
    expect(isPetAllowed(ctx as never, req)).toBe(true)
    expect(isPairedDevice).toHaveBeenCalledWith(req)
  })

  it('refuses a LAN client when pairing returns false (revoked or unknown)', () => {
    const ctx = { get: () => ({ isPairedDevice: () => false }) }
    expect(isPetAllowed(ctx as never, request({
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
      cookie: 'dsh_pair=revoked',
    }))).toBe(false)
  })

  it('refuses instead of throwing when the property lookup throws (un-injected cordis service)', () => {
    // Given a real cordis context whose un-injected service throws on read
    const ctx = Object.defineProperty({}, 'remoteWebUiPairing', {
      get(): never {
        throw new Error('cannot get property "remoteWebUiPairing" without inject')
      },
    })
    // When a LAN request reaches the fence
    // Then it answers "not paired" instead of leaking the error as an empty-body 400
    expect(isPetAllowed(ctx as never, request({
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
      cookie: 'dsh_pair=dev-1',
    }))).toBe(false)
  })

  it('never reads the throwing property when ctx.get already answered', () => {
    const get = vi.fn(() => undefined)
    const ctx = Object.defineProperty({ get }, 'remoteWebUiPairing', {
      get(): never {
        throw new Error('cannot get property "remoteWebUiPairing" without inject')
      },
    })
    expect(isPetAllowed(ctx as never, request({
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
    }))).toBe(false)
    expect(get).toHaveBeenCalledWith('remoteWebUiPairing', false)
  })

  it('allows a remote client admitted by the official host connection service', () => {
    // Given an official host connection service that admits the remote browser
    const req = request({
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
      cookie: 'dsh_session=ok',
    })
    const admit = vi.fn(() => ({ peer: { id: 'remote-1' } }))
    const ctx = { get: (name: string) => name === 'connection' ? { admit } : undefined }

    // When the pet access fence evaluates the request
    const allowed = isPetAllowed(ctx as never, req)

    // Then the admitted remote client is allowed through
    expect(allowed).toBe(true)
    expect(admit).toHaveBeenCalledWith(req)
  })

  it('refuses a remote client rejected by the official host connection service', () => {
    // Given an official host connection service that rejects the request
    const req = request({
      remoteAddress: '192.168.1.20',
      host: 'dsh.example:443',
    })
    const ctx = { get: (name: string) => name === 'connection' ? { admit: () => ({ rejection: { status: 401 } }) } : undefined }

    // When the pet access fence evaluates the request
    const allowed = isPetAllowed(ctx as never, req)

    // Then the rejected client stays blocked
    expect(allowed).toBe(false)
  })
})
