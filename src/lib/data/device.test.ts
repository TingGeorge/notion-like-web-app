import { describe, expect, it } from 'vitest'
import { t } from '../../strings/zh-TW'
import { deviceName, isApplePlatform, isIOS, isSafariTab, isStandalone, shortcutLabel, usesCommandKey, type DeviceEnv } from './device'

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/125.0.2535.60 Mobile/15E148 Safari/605.1.15',
  iphoneHomeScreen:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadDesktopMode:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0',
  winEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  winChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  winOpera:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/110.0.0.0',
  linuxChrome:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.52 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  chromeOS: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
}

describe('deviceName (SYNC-9)', () => {
  const table: [string, DeviceEnv, string][] = [
    ['iPhone Safari', { userAgent: UA.iphoneSafari }, 'iPhone · Safari'],
    ['iPhone Chrome', { userAgent: UA.iphoneChrome }, 'iPhone · Chrome'],
    ['iPhone Firefox', { userAgent: UA.iphoneFirefox }, 'iPhone · Firefox'],
    ['iPhone Edge', { userAgent: UA.iphoneEdge }, 'iPhone · Edge'],
    ['iPhone home screen', { userAgent: UA.iphoneHomeScreen, standalone: true }, 'iPhone · Safari'],
    ['iPad Safari', { userAgent: UA.ipadSafari }, 'iPad · Safari'],
    ['iPad in desktop mode', { userAgent: UA.ipadDesktopMode, maxTouchPoints: 5 }, 'iPad · Safari'],
    ['Mac Safari', { userAgent: UA.macSafari, maxTouchPoints: 0 }, 'Mac · Safari'],
    ['Mac Chrome', { userAgent: UA.macChrome }, 'Mac · Chrome'],
    ['Mac Firefox', { userAgent: UA.macFirefox }, 'Mac · Firefox'],
    ['Windows Edge', { userAgent: UA.winEdge }, 'Windows 電腦 · Edge'],
    ['Windows Chrome', { userAgent: UA.winChrome }, 'Windows 電腦 · Chrome'],
    ['Windows Firefox', { userAgent: UA.winFirefox }, 'Windows 電腦 · Firefox'],
    ['Windows Opera', { userAgent: UA.winOpera }, 'Windows 電腦 · Opera'],
    ['Linux Chrome', { userAgent: UA.linuxChrome }, 'Linux 電腦 · Chrome'],
    ['Linux Firefox', { userAgent: UA.linuxFirefox }, 'Linux 電腦 · Firefox'],
    ['Android Chrome', { userAgent: UA.androidChrome }, 'Android · Chrome'],
    ['Android Firefox', { userAgent: UA.androidFirefox }, 'Android · Firefox'],
    ['Android Samsung Internet', { userAgent: UA.androidSamsung }, 'Android · Samsung Internet'],
    ['ChromeOS', { userAgent: UA.chromeOS }, 'Linux 電腦 · Chrome'],
    ['empty UA with client hints', { userAgent: '', userAgentData: { platform: 'Windows' } }, 'Windows 電腦'],
    ['unknown', { userAgent: 'curl/8.0' }, t.device.computer],
  ]
  it.each(table)('%s', (_name, env, expected) => {
    expect(deviceName(env)).toBe(expected)
  })
})

describe('platform checks', () => {
  it('isIOS', () => {
    expect(isIOS({ userAgent: UA.iphoneSafari })).toBe(true)
    expect(isIOS({ userAgent: UA.ipadDesktopMode, maxTouchPoints: 5 })).toBe(true)
    expect(isIOS({ userAgent: UA.macSafari, maxTouchPoints: 0 })).toBe(false)
    expect(isIOS({ userAgent: UA.androidChrome })).toBe(false)
  })

  it('isStandalone (SETUP-2)', () => {
    expect(isStandalone({ userAgent: UA.iphoneSafari })).toBe(false)
    expect(isStandalone({ userAgent: UA.iphoneSafari, standalone: false })).toBe(false)
    expect(isStandalone({ userAgent: UA.iphoneSafari, standalone: true })).toBe(true)
    expect(isStandalone({ userAgent: UA.winEdge, displayModeStandalone: true })).toBe(true)
  })

  it('isSafariTab (SETUP-13)', () => {
    expect(isSafariTab({ userAgent: UA.iphoneSafari })).toBe(true)
    expect(isSafariTab({ userAgent: UA.iphoneSafari, standalone: true })).toBe(false)
    expect(isSafariTab({ userAgent: UA.iphoneHomeScreen, standalone: true })).toBe(false)
    expect(isSafariTab({ userAgent: UA.ipadSafari })).toBe(true)
    expect(isSafariTab({ userAgent: UA.macSafari, maxTouchPoints: 0 })).toBe(true)
    expect(isSafariTab({ userAgent: UA.macSafari, maxTouchPoints: 0, displayModeStandalone: true })).toBe(false)
    expect(isSafariTab({ userAgent: UA.macChrome })).toBe(false)
    expect(isSafariTab({ userAgent: UA.iphoneChrome })).toBe(false)
    expect(isSafariTab({ userAgent: UA.winChrome })).toBe(false)
  })

  it('isApplePlatform', () => {
    expect(isApplePlatform({ userAgent: UA.macChrome })).toBe(true)
    expect(isApplePlatform({ userAgent: UA.iphoneSafari })).toBe(true)
    expect(isApplePlatform({ userAgent: UA.winChrome })).toBe(false)
    expect(isApplePlatform({ userAgent: UA.linuxFirefox })).toBe(false)
  })

  it('usesCommandKey follows the platform, as ProseMirror keymaps do', () => {
    expect(usesCommandKey({ userAgent: UA.macChrome, platform: 'MacIntel' })).toBe(true)
    expect(usesCommandKey({ userAgent: UA.iphoneSafari, platform: 'iPhone' })).toBe(true)
    expect(usesCommandKey({ userAgent: UA.macChrome, userAgentData: { platform: 'macOS' }, platform: 'MacIntel' })).toBe(true)
    expect(usesCommandKey({ userAgent: UA.winChrome, platform: 'Win32' })).toBe(false)
    expect(usesCommandKey({ userAgent: UA.linuxFirefox, platform: 'Linux x86_64' })).toBe(false)
    // A Mac user agent on another platform (an emulated device): the keys the editor reacts to win.
    expect(usesCommandKey({ userAgent: UA.macChrome, platform: 'Linux x86_64' })).toBe(false)
    expect(usesCommandKey({ userAgent: UA.macChrome })).toBe(false)
  })
})

describe('shortcutLabel (§7.1)', () => {
  it('keeps ⌘ on Apple platforms', () => {
    expect(shortcutLabel('⌘⌥N', true)).toBe('⌘⌥N')
  })

  const table: [string, string][] = [
    ['⌘K / ⌘P', 'Ctrl+K / Ctrl+P'],
    ['⌘K（選取文字時）', 'Ctrl+K（選取文字時）'],
    ['⌘⌥N', 'Ctrl+Alt+N'],
    ['⌘\\', 'Ctrl+\\'],
    ['⌘⇧L', 'Ctrl+Shift+L'],
    ['⌘[ / ⌘]', 'Ctrl+[ / Ctrl+]'],
    ['⌘B / ⌘I / ⌘U', 'Ctrl+B / Ctrl+I / Ctrl+U'],
    ['⌘⇧S / ⌘E', 'Ctrl+Shift+S / Ctrl+E'],
    ['⌘⌥0 … ⌘⌥8', 'Ctrl+Shift+0 … Ctrl+Shift+8'],
    ['⌘Enter', 'Ctrl+Enter'],
    ['⌘⇧↑ / ⌘⇧↓', 'Ctrl+Shift+↑ / Ctrl+Shift+↓'],
    ['Tab / ⇧Tab', 'Tab / Shift+Tab'],
    ['Esc', 'Esc'],
  ]
  it.each(table)('%s → %s', (input, expected) => {
    expect(shortcutLabel(input, false)).toBe(expected)
  })

  it('translates every shortcut in the strings table', () => {
    for (const [keys] of t.shortcuts.list) expect(shortcutLabel(keys, false)).not.toMatch(/[⌘⌥⇧]/)
  })
})
