/**
 * Device and platform detection: the device name for commits (SYNC-9), standalone and Safari-tab
 * checks (SETUP-2, SETUP-13), and keyboard shortcut labels (§7.1).
 *
 * Everything takes an optional `DeviceEnv` so it can be tested with real user-agent strings;
 * without one it reads `navigator` and `matchMedia`.
 */
import { t } from '../../strings'

export interface DeviceEnv {
  userAgent: string
  /** `navigator.maxTouchPoints`: iPadOS 13+ reports a Mac user agent but has touch. */
  maxTouchPoints?: number
  /** `navigator.userAgentData` (Chromium), if present. */
  userAgentData?: { platform?: string; mobile?: boolean } | null
  /** `navigator.platform` (`MacIntel`, `iPhone`, `Win32`, `Linux x86_64`…). */
  platform?: string
  /** iOS Safari's `navigator.standalone`. */
  standalone?: boolean
  /** `matchMedia('(display-mode: standalone)').matches`. */
  displayModeStandalone?: boolean
}

export type DeviceKind = 'iphone' | 'ipad' | 'mac' | 'windows' | 'linux' | 'android' | 'other'
export type BrowserKind = 'safari' | 'chrome' | 'edge' | 'firefox' | 'opera' | 'samsung' | 'other'

const BROWSER_NAMES: Record<Exclude<BrowserKind, 'other'>, string> = {
  safari: 'Safari',
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  opera: 'Opera',
  samsung: 'Samsung Internet',
}

export function currentEnv(): DeviceEnv {
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as Navigator & {
    standalone?: boolean
    userAgentData?: { platform?: string; mobile?: boolean }
  }
  let displayModeStandalone = false
  try {
    displayModeStandalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches
  } catch {
    // no matchMedia
  }
  return {
    userAgent: nav.userAgent ?? '',
    maxTouchPoints: nav.maxTouchPoints,
    userAgentData: nav.userAgentData ?? null,
    platform: nav.platform,
    standalone: nav.standalone,
    displayModeStandalone,
  }
}

export function deviceKind(env: DeviceEnv = currentEnv()): DeviceKind {
  const ua = env.userAgent
  if (/iPhone|iPod/.test(ua)) return 'iphone'
  if (/iPad/.test(ua)) return 'ipad'
  if (/Android/.test(ua)) return 'android'
  // iPadOS 13+ asks for the desktop site by default and sends a Mac user agent.
  if (/Macintosh|Mac OS X/.test(ua)) return (env.maxTouchPoints ?? 0) > 1 ? 'ipad' : 'mac'
  if (/Windows/.test(ua)) return 'windows'
  if (/Linux|X11|CrOS/.test(ua)) return 'linux'
  switch (env.userAgentData?.platform) {
    case 'macOS':
      return 'mac'
    case 'Windows':
      return 'windows'
    case 'Android':
      return 'android'
    case 'Linux':
    case 'Chrome OS':
      return 'linux'
  }
  return 'other'
}

export function browserKind(env: DeviceEnv = currentEnv()): BrowserKind {
  const ua = env.userAgent
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'edge'
  if (/OPR\/|Opera|OPiOS/.test(ua)) return 'opera'
  if (/SamsungBrowser/.test(ua)) return 'samsung'
  if (/Firefox\/|FxiOS/.test(ua)) return 'firefox'
  if (/Chrome\/|CriOS/.test(ua)) return 'chrome'
  // A home-screen web app on iOS has no `Safari/` token but is still Safari's engine.
  if (/Safari\//.test(ua) || (/AppleWebKit/.test(ua) && /iPhone|iPad|iPod/.test(ua))) return 'safari'
  return 'other'
}

function deviceLabel(kind: DeviceKind): string {
  switch (kind) {
    case 'iphone':
      return t.device.iphone
    case 'ipad':
      return t.device.ipad
    case 'mac':
      return t.device.mac
    case 'windows':
      return t.device.windows
    case 'linux':
      return t.device.linux
    case 'android':
      return t.device.android
    default:
      return t.device.computer
  }
}

/** SYNC-9: `iPhone · Safari`, `Mac · Chrome`, `Windows 電腦 · Edge`. */
export function deviceName(env: DeviceEnv = currentEnv()): string {
  const device = deviceLabel(deviceKind(env))
  const browser = browserKind(env)
  return browser === 'other' ? device : `${device} · ${BROWSER_NAMES[browser]}`
}

export function isIOS(env: DeviceEnv = currentEnv()): boolean {
  const kind = deviceKind(env)
  return kind === 'iphone' || kind === 'ipad'
}

/** Mac, iPhone and iPad (from the user agent). */
export function isApplePlatform(env: DeviceEnv = currentEnv()): boolean {
  return isIOS(env) || deviceKind(env) === 'mac'
}

/**
 * §7.1: shortcuts use ⌘ rather than Ctrl. Decided from the platform the same way ProseMirror's own
 * keymaps decide `Mod-`, so the app's shortcuts, the editor's and the labels always agree.
 */
export function usesCommandKey(env: DeviceEnv = currentEnv()): boolean {
  return /mac|iphone|ipad|ipod/i.test(env.userAgentData?.platform || env.platform || '')
}

/** SETUP-2: running as an installed app (iOS home screen, or a desktop/Android PWA window). */
export function isStandalone(env: DeviceEnv = currentEnv()): boolean {
  return env.standalone === true || env.displayModeStandalone === true
}

/** SETUP-13: iOS Safari that is not a home-screen app, or Safari on a Mac. */
export function isSafariTab(env: DeviceEnv = currentEnv()): boolean {
  if (isStandalone(env) || browserKind(env) !== 'safari') return false
  const kind = deviceKind(env)
  return kind === 'iphone' || kind === 'ipad' || kind === 'mac'
}

const MODIFIERS = /[⌘⌥⇧⌃]+/gu

/**
 * §7.1: shortcuts are written the Mac way. On other platforms `⌘` becomes `Ctrl`, `⌥` `Alt`,
 * `⇧` `Shift`, and `⌘⌥<digit>` becomes `Ctrl+Shift+<digit>` (`⌘⌥N` → `Ctrl+Alt+N`).
 * Text around the shortcuts is kept: `⌘B / ⌘I` → `Ctrl+B / Ctrl+I`.
 */
export function shortcutLabel(label: string, apple: boolean = usesCommandKey()): string {
  if (apple) return label
  return label.replace(new RegExp(`(${MODIFIERS.source})(.?)`, 'gu'), (_m, mods: string, next: string) => {
    const has = (c: string) => mods.includes(c)
    const parts: string[] = []
    if (has('⌘') || has('⌃')) parts.push('Ctrl')
    if (has('⌥')) parts.push(/[0-9]/.test(next) && has('⌘') ? 'Shift' : 'Alt')
    if (has('⇧')) parts.push('Shift')
    return `${[...new Set(parts)].join('+')}+${next}`
  })
}
