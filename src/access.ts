/**
 * Pet trust fence: loopback (the desktop) always passes; requests admitted by
 * the official Host `connection` service (including official remote-connection
 * paired browsers) or a legacy paired-device cookie service are additional
 * allow paths. Without either service the fence stays loopback-only.
 */
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { isPairedOrLoopbackAllowed } from './pair-access.ts'

/**
 * Whether this request may enter any /api/pet or /pet asset route.
 * @param ctx - host context; may expose `connection` or legacy `remoteWebUiPairing`.
 * @param request - the incoming HTTP request.
 * @returns true for loopback, an official host-admitted connection, or a paired-device cookie.
 */
export function isPetAllowed(ctx: Context, request: IncomingMessage): boolean {
  return isPairedOrLoopbackAllowed(ctx, request)
}
