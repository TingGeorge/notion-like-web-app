/**
 * The UI language (NFR-4): 繁體中文 (default) or English, chosen per device in 設定 → 外觀與語言.
 * The choice is read once at startup, before any module reads `t`, and changing it reloads the app.
 * It lives in localStorage rather than the database because it is needed synchronously.
 */
import { en } from './en'
import { zhTW, type Strings } from './zh-TW'

export type { Strings }
export type Language = 'zh-TW' | 'en'

export const LANGUAGES: readonly Language[] = ['zh-TW', 'en']
const STORAGE_KEY = 'ghnotes.language'

function readLanguage(): Language {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    return stored === 'en' ? 'en' : 'zh-TW'
  } catch {
    return 'zh-TW'
  }
}

export const language: Language = readLanguage()

/** Every UI string, in the device's language. */
export const t: Strings = language === 'en' ? en : zhTW

/** BCP 47 tag for `<html lang>`. */
export const htmlLang = language === 'en' ? 'en' : 'zh-Hant-TW'

/** Saves the choice and reloads, so every screen and module picks it up. */
export function setLanguage(next: Language): void {
  if (next === language) return
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    return
  }
  location.reload()
}
