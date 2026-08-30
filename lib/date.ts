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

export function getMonthNumber(monthName: string): number {
  return MONTH_NAMES.indexOf(monthName) + 1
}

/**
 * Día siguiente, cruzando el fin de mes y de año.
 *
 * Hace falta para el aviso de "mañana toca pagar": el día 31 de agosto,
 * sumar 1 al día daría "31 de agosto + 1 = día 32 de agosto", que no existe y
 * hacía que los pagos del 1 de septiembre — el día más cargado del mes — nunca
 * se anunciaran.
 */
export function getNextDay(year: number, month: number, day: number) {
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
    monthName: MONTH_NAMES[next.getUTCMonth()],
  }
}
