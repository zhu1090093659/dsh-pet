import { describe, expect, it } from 'vitest'

import { classifyDesktop, DesktopProbe } from './desktop-activity.ts'

describe('classifyDesktop', () => {
  it('maps games by process name', () => {
    expect(classifyDesktop('GenshinImpact.exe', 'Genshin Impact')).toBe('game')
    expect(classifyDesktop('steam', 'Steam')).toBe('game')
    expect(classifyDesktop('javaw', 'Minecraft 1.20')).toBe('game')
  })

  it('maps games by window title even when the process is generic', () => {
    expect(classifyDesktop('game', '原神')).toBe('game')
    expect(classifyDesktop('main', '崩坏：星穹铁道')).toBe('game')
  })

  it('maps video, music, browser, editor, terminal and office', () => {
    expect(classifyDesktop('vlc', 'something.mkv')).toBe('video')
    expect(classifyDesktop('chrome', '哔哩哔哩 - 首页')).toBe('video')
    expect(classifyDesktop('spotify', 'Spotify Premium')).toBe('music')
    expect(classifyDesktop('chrome', 'DeepSeek')).toBe('browser')
    expect(classifyDesktop('Code', 'index.ts - dsh-pet')).toBe('editor')
    expect(classifyDesktop('WindowsTerminal', 'pwsh')).toBe('terminal')
    expect(classifyDesktop('WINWORD', '文档1')).toBe('office')
  })

  it('falls back to other', () => {
    expect(classifyDesktop('explorer', 'Program Manager')).toBe('other')
    expect(classifyDesktop('', '')).toBe('other')
  })

  it('never probes on non-Windows platforms', async () => {
    const probe = new DesktopProbe({ platform: 'linux' })
    expect(probe.read()).toBeUndefined()
    await expect(probe.refresh()).resolves.toBeUndefined()
  })
})
