const TZ = 'America/Caracas'

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function getNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = Number(parts.find(p => p.type === 'year')!.value)
  const month = Number(parts.find(p => p.type === 'month')!.value) // 1-based
  const day = Number(parts.find(p => p.type === 'day')!.value)
  const monthName = MONTH_NAMES[month - 1]

  return { year, month, day, monthName }
}

export function getPreviousMonth(monthName: string): string {
  const idx = MONTH_NAMES.indexOf(monthName)
  return idx <= 0 ? MONTH_NAMES[11] : MONTH_NAMES[idx - 1]
}
