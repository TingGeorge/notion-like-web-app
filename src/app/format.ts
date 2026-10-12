import { t } from '../strings/zh-TW'

const pad = (n: number) => String(n).padStart(2, '0')

export function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 「剛剛」, 「3 分鐘前」, 「2 小時前」, 「昨天」, 「5 天前」, … */
export function relativeTime(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return t.common.justNow
  if (min < 60) return t.common.minutesAgo(min)
  const hours = Math.floor(min / 60)
  if (hours < 24 && startOfDay(ms) === startOfDay(now)) return t.common.hoursAgo(hours)
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000)
  if (days <= 1) return t.common.yesterday
  if (days < 7) return t.common.daysAgo(days)
  if (days < 30) return t.common.weeksAgo(Math.floor(days / 7))
  return t.common.monthsAgo(Math.max(1, Math.floor(days / 30)))
}

/** History rows: 「今天 10:42」, 「昨天 22:03」, 「10/9 18:30」, 「2025/12/31 18:30」. */
export function historyTime(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000)
  if (days === 0) return `${t.common.today} ${hhmm(ms)}`
  if (days === 1) return `${t.common.yesterday} ${hhmm(ms)}`
  if (d.getFullYear() === new Date(now).getFullYear()) return `${d.getMonth() + 1}/${d.getDate()} ${hhmm(ms)}`
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hhmm(ms)}`
}

/** `2027-01-10` → `2027/01/10`. */
export function displayDate(isoDate: string): string {
  return isoDate.replaceAll('-', '/')
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Days from today until a `YYYY-MM-DD` date (negative when past). */
export function daysUntil(isoDate: string, now = Date.now()): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  const target = new Date(y, (m || 1) - 1, d || 1).getTime()
  return Math.round((target - startOfDay(now)) / 86_400_000)
}

/** UI-11 greeting by hour: 早安 05:00–10:59, 午安 11:00–17:59, 晚安 otherwise. */
export function greetingWord(date = new Date()): string {
  const h = date.getHours()
  if (h >= 5 && h < 11) return t.home.morning
  if (h >= 11 && h < 18) return t.home.afternoon
  return t.home.evening
}
