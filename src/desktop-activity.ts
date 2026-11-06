/**
 * What is the user doing on this machine right now?
 *
 * The pet already reacts to DSH's own activity phases; this adds the desktop
 * context around them (a game, a video, an editor) so the idle chatter can be
 * a little less generic. Everything stays local: one PowerShell probe reads the
 * foreground window's process name and title, nothing leaves the machine.
 */
import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const DESKTOP_CATEGORIES = [
  'game',
  'video',
  'music',
  'browser',
  'editor',
  'terminal',
  'office',
  'other',
] as const

export type DesktopCategory = (typeof DESKTOP_CATEGORIES)[number]

export interface DesktopActivity {
  category: DesktopCategory
  /** Foreground process name (lowercased, without `.exe`). */
  process: string
  /** Window title, trimmed and capped. */
  title: string
  /** Epoch ms of the reading. */
  at: number
}

const GAME_PROCESSES = [
  'steam', 'steamwebhelper', 'gameoverlayui', 'epicgameslauncher', 'battle.net', 'galaxyclient',
  'leagueclient', 'league of legends', 'valorant', 'valorant-win64-shipping',
  'genshinimpact', 'yuanshen', 'starrail', 'zenlesszonezero', 'zenlesszonezero',
  'minecraft', 'javaw', 'dota2', 'cs2', 'csgo', 'overwatch', 'wow', 'diablo iv',
  'eldenring', 'sekiro', 'hades', 'hades2', 'stardew valley', 'terraria', 'apex_legends',
  'pubg', 'gta5', 'rdr2', 'bg3', 'baldursgate3', 'palworld', 'helldivers2', 'warframe',
  'ffxivboot', 'ffxiv_dx11', 'lostark', 'maplestory', 'dnf', 'naraka', 'snowbreak',
]

const GAME_TITLE_HINTS = [
  '原神', '崩坏', '绝区零', '星穹铁道', '鸣潮', '明日方舟', '王者荣耀', '英雄联盟',
  'steam', 'epic games', 'minecraft', 'elden ring', 'baldur', 'stardew',
]

const VIDEO_PROCESSES = ['potplayermini64', 'potplayermini', 'vlc', 'mpv', 'mpc-hc64', 'kmplayer', 'bilibili']
const VIDEO_TITLE_HINTS = ['youtube', 'bilibili', '哔哩哔哩', 'netflix', '爱奇艺', '腾讯视频', '优酷', 'niconico']

const MUSIC_PROCESSES = ['spotify', 'cloudmusic', 'foobar2000', 'qqmusic', 'aimp', 'musicbee']
const BROWSER_PROCESSES = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc']
const EDITOR_PROCESSES = [
  'code', 'code - insiders', 'cursor', 'devenv', 'idea64', 'webstorm64', 'pycharm64',
  'goland64', 'rider64', 'sublime_text', 'notepad++', 'notepad', 'zed',
]
const TERMINAL_PROCESSES = ['windowsterminal', 'wt', 'powershell', 'pwsh', 'cmd', 'conhost', 'alacritty', 'wezterm']
const OFFICE_PROCESSES = ['winword', 'excel', 'powerpnt', 'wps', 'et', 'wpp', 'notion', 'obsidian', 'typora', 'acrobat']

const has = (haystack: string, needles: readonly string[]): boolean => needles.some(needle => haystack.includes(needle))

/** Map a foreground window onto the bucket the chatter pools are keyed by. */
export function classifyDesktop(processName: string, title: string): DesktopCategory {
  const proc = processName.toLowerCase().replace(/\.exe$/, '').trim()
  const text = title.toLowerCase()
  if (has(proc, GAME_PROCESSES) || has(text, GAME_TITLE_HINTS)) return 'game'
  if (has(proc, VIDEO_PROCESSES) || has(text, VIDEO_TITLE_HINTS)) return 'video'
  if (has(proc, MUSIC_PROCESSES)) return 'music'
  if (has(proc, TERMINAL_PROCESSES)) return 'terminal'
  if (has(proc, EDITOR_PROCESSES)) return 'editor'
  if (has(proc, OFFICE_PROCESSES)) return 'office'
  if (has(proc, BROWSER_PROCESSES)) return 'browser'
  return 'other'
}

/** PowerShell one-shot: foreground window -> { process, title } as JSON. */
const PROBE_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class DshPetFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$h = [DshPetFg]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][DshPetFg]::GetWindowText($h, $sb, 512)
$target = 0
[void][DshPetFg]::GetWindowThreadProcessId($h, [ref]$target)
$p = Get-Process -Id $target -ErrorAction SilentlyContinue
@{ process = $p.ProcessName; title = $sb.ToString() } | ConvertTo-Json -Compress
`

export interface DesktopProbeOptions {
  /** How long a reading stays fresh (ms). */
  ttlMs?: number
  /** Hard cap on one probe (ms). */
  timeoutMs?: number
  platform?: NodeJS.Platform
}

/**
 * Caches the foreground reading: the host polls its state every couple of
 * seconds, and spawning PowerShell that often would be silly.
 */
export class DesktopProbe {
  private readonly ttlMs: number
  private readonly timeoutMs: number
  private readonly platform: NodeJS.Platform
  private scriptPath: string | undefined
  private current: DesktopActivity | undefined
  private inflight: Promise<void> | undefined

  constructor(options: DesktopProbeOptions = {}) {
    this.ttlMs = options.ttlMs ?? 20_000
    this.timeoutMs = options.timeoutMs ?? 8_000
    this.platform = options.platform ?? process.platform
  }

  /** The last reading, refreshed in the background when stale. */
  read(): DesktopActivity | undefined {
    if (this.platform !== 'win32') return undefined
    const now = Date.now()
    if (this.current !== undefined && now - this.current.at < this.ttlMs) return this.current
    if (this.inflight === undefined) {
      this.inflight = this.probe().finally(() => { this.inflight = undefined })
    }
    return this.current
  }

  /** Await one fresh reading (tests and the first paint). */
  async refresh(): Promise<DesktopActivity | undefined> {
    if (this.platform !== 'win32') return undefined
    await this.probe()
    return this.current
  }

  private ensureScript(): string {
    if (this.scriptPath !== undefined) return this.scriptPath
    const path = join(tmpdir(), 'dsh-pet-desktop-probe.ps1')
    writeFileSync(path, PROBE_SCRIPT, 'utf8')
    this.scriptPath = path
    return path
  }

  private probe(): Promise<void> {
    return new Promise<void>((resolve) => {
      let script: string
      try {
        script = this.ensureScript()
      } catch {
        resolve()
        return
      }
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { timeout: this.timeoutMs, windowsHide: true },
        (error, stdout) => {
          if (error !== null) {
            resolve()
            return
          }
          try {
            const parsed = JSON.parse(stdout.trim()) as { process?: unknown; title?: unknown }
            const processName = typeof parsed.process === 'string' ? parsed.process : ''
            if (processName === '') {
              resolve()
              return
            }
            const title = typeof parsed.title === 'string' ? parsed.title.slice(0, 120) : ''
            this.current = {
              category: classifyDesktop(processName, title),
              process: processName.toLowerCase(),
              title,
              at: Date.now(),
            }
          } catch {
            // A half-written or localised payload is not worth a warning.
          }
          resolve()
        },
      )
    })
  }
}
