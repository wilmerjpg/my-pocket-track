import { MONTH_NAMES } from '@/lib/date'
import { getExpectedRows } from '@/lib/sheets'

/**
 * Contrato de la hoja "Pagos" (pagos fijos esperados).
 *
 * Este módulo es el ÚNICO lugar que conoce la forma de esa hoja. El resto de la
 * app trabaja con `ExpectedBill`, nunca con índices de columna.
 *
 * La hoja es una sola lista canónica de pagos — no una pestaña por mes. Qué se
 * paga en un mes dado se deriva de las columnas `Frecuencia` / `Mes base` /
 * `Desde` / `Hasta`, y ese cálculo vive en `occursIn`.
 */

export type Frequency = 'Mensual' | 'Trimestral' | 'Anual'

/** Referencia a un mes calendario, p.ej. "Sep 2026" → { year: 2026, month: 9 }. */
export interface MonthRef {
  year: number
  month: number // 1-12
}

export interface ExpectedBill {
  id: string
  isActive: boolean
  owner: string
  category: string
  description: string
  /** Monto tal cual viene de la hoja, p.ej. "$3,500.00" — se escribe verbatim en la hoja de gastos. */
  amount: string
  paymentMethod: string
  isAuto: boolean
  dayOfMonth: number
  frequency: Frequency
  /** Mes ancla: para "Anual" es el mes en que ocurre; para "Trimestral", el primero del ciclo. 0 = no aplica. */
  baseMonth: number
  /** Meses explícitos (columna "Meses personalizados"); si viene, gana sobre `frequency`. */
  customMonths: number[]
  from: MonthRef | null
  until: MonthRef | null
}

export interface ExpectedSheet {
  bills: ExpectedBill[]
  /** Filas que no se pudieron interpretar. Se reportan en vez de descartarse en silencio. */
  issues: string[]
}

/**
 * Los pagos esperados son fijos por definición, y la hoja de gastos exige un
 * valor en la columna "Type". La hoja "Pagos" ya no lleva esa columna porque
 * en la versión anterior era "Fijo" en las 614 filas reales.
 */
const EXPENSE_TYPE = 'Fijo'

/** Encabezado lógico → posibles nombres en la hoja (normalizados). */
const COLUMN_ALIASES = {
  id: ['id'],
  isActive: ['activo'],
  owner: ['owner'],
  category: ['categoria'],
  description: ['descripcion'],
  amount: ['monto'],
  paymentMethod: ['metodo de pago'],
  isAuto: ['auto'],
  dayOfMonth: ['dia'],
  frequency: ['frecuencia'],
  baseMonth: ['mes base'],
  customMonths: ['meses personalizados'],
  from: ['desde'],
  until: ['hasta'],
} as const

type ColumnKey = keyof typeof COLUMN_ALIASES

/** Sin acentos, sin paréntesis y en minúsculas: "Mes base (1-12)" → "mes base". */
function normalizeHeader(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** La hoja abre con filas de título, así que el encabezado se busca por contenido. */
function findHeaderRow(rows: string[][]): number {
  return rows.findIndex(row => {
    const cells = (row || []).map(normalizeHeader)
    return cells.includes('id') && cells.includes('owner') && cells.includes('dia')
  })
}

function resolveColumns(headerRow: string[]): { columns: Record<ColumnKey, number>; missing: string[] } {
  const cells = headerRow.map(normalizeHeader)
  const columns = {} as Record<ColumnKey, number>
  const missing: string[] = []

  for (const [key, aliases] of Object.entries(COLUMN_ALIASES) as [ColumnKey, readonly string[]][]) {
    const index = cells.findIndex(cell => aliases.includes(cell))
    if (index === -1) missing.push(aliases[0])
    columns[key] = index
  }
  return { columns, missing }
}

/** "Sí" / "Yes" / "true" → true. Cualquier otra cosa → false. */
function isYes(value: string | undefined): boolean {
  const v = normalizeHeader(value ?? '')
  return v === 'si' || v === 'yes' || v === 'true'
}

/** "Sep 2026" → { year: 2026, month: 9 }. Devuelve null si está vacío; undefined si no se entiende. */
function parseMonthRef(value: string | undefined): MonthRef | null | undefined {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const match = raw.match(/^([A-Za-zÁ-úá-ú]+)\s+(\d{4})$/)
  if (!match) return undefined

  const prefix = normalizeHeader(match[1]).slice(0, 3)
  const index = MONTH_NAMES.findIndex(name => name.toLowerCase().startsWith(prefix))
  return index === -1 ? undefined : { year: Number(match[2]), month: index + 1 }
}

function parseFrequency(value: string | undefined): Frequency | undefined {
  switch (normalizeHeader(value ?? '')) {
    case 'mensual': return 'Mensual'
    case 'trimestral': return 'Trimestral'
    case 'anual': return 'Anual'
    default: return undefined
  }
}

/** Monto numérico a partir del texto de la hoja: "$3,500.00" → 3500. */
export function amountValue(amount: string): number {
  return Number(String(amount ?? '').replace(/[$,\s]/g, '')) || 0
}

/** Orden absoluto de meses, para comparar ventanas Desde/Hasta. */
const absoluteMonth = (year: number, month: number) => year * 12 + month

/** ¿Este pago cae en el mes indicado? */
export function occursIn(bill: ExpectedBill, year: number, month: number): boolean {
  if (!bill.isActive) return false

  const target = absoluteMonth(year, month)
  if (bill.from && target < absoluteMonth(bill.from.year, bill.from.month)) return false
  if (bill.until && target > absoluteMonth(bill.until.year, bill.until.month)) return false

  if (bill.customMonths.length > 0) return bill.customMonths.includes(month)

  switch (bill.frequency) {
    case 'Mensual':
      return true
    case 'Trimestral':
      return bill.baseMonth > 0 && (month - bill.baseMonth) % 3 === 0
    case 'Anual':
      return month === bill.baseMonth
  }
}

/**
 * Día en que vence el pago dentro de un mes concreto. Un "Día 31" en un mes de
 * 30 se cobra el último día en vez de desaparecer del calendario.
 */
export function dueDayIn(bill: ExpectedBill, year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Math.min(bill.dayOfMonth, lastDay)
}

export function billsDueOn(bills: ExpectedBill[], year: number, month: number, day: number): ExpectedBill[] {
  return bills.filter(bill => occursIn(bill, year, month) && dueDayIn(bill, year, month) === day)
}

export function billsForMonth(bills: ExpectedBill[], year: number, month: number): ExpectedBill[] {
  return bills
    .filter(bill => occursIn(bill, year, month))
    .sort((a, b) => dueDayIn(a, year, month) - dueDayIn(b, year, month))
}

/** Fila para la hoja de gastos: Owner, Category, Type, Payment Method, Description, Amount, Date. */
export function toExpenseRow(bill: ExpectedBill, date: string): string[] {
  return [bill.owner, bill.category, EXPENSE_TYPE, bill.paymentMethod, bill.description, bill.amount, date]
}

/**
 * ¿El pago ya está registrado como gasto este mes?
 *
 * La clave incluye el monto a propósito: hay pagos que comparten owner y
 * descripción y solo se distinguen por monto y día (P013 "Wilmer Padre /
 * Comida" $160 el día 1 vs. P040 el mismo texto por $70 el día 13). Sin el
 * monto, registrar uno marcaría el otro como pagado.
 */
export function isAlreadyLogged(bill: ExpectedBill, expenseRows: string[][]): boolean {
  const key = (owner: string, description: string, amount: string) =>
    `${owner ?? ''}|${description ?? ''}`.toLowerCase() + `|${amountValue(amount)}`

  const billKey = key(bill.owner, bill.description, bill.amount)
  return expenseRows.some(row => key(row[0], row[4], row[5]) === billKey)
}

/** Vista plana de un pago para pasárselo a Claude. */
export function toClaudeRecord(bill: ExpectedBill, year: number, month: number) {
  return {
    month: MONTH_NAMES[month - 1],
    day: dueDayIn(bill, year, month),
    owner: bill.owner,
    category: bill.category,
    description: bill.description,
    amount: bill.amount,
    paymentMethod: bill.paymentMethod,
    auto: bill.isAuto ? 'Sí' : 'No',
    frequency: bill.frequency,
  }
}

/**
 * Lee la hoja "Pagos" y devuelve los pagos ya interpretados.
 *
 * Las filas inválidas no se descartan en silencio: se acumulan en `issues` para
 * que quien llama pueda avisar. Una fila mal cargada equivale a un recordatorio
 * que nunca llega, y ese es justo el error que no se nota.
 */
export async function loadExpected(): Promise<ExpectedSheet> {
  const rows = await getExpectedRows()

  const headerIndex = findHeaderRow(rows)
  if (headerIndex === -1) {
    throw new Error('No se encontró la fila de encabezados en la hoja "Pagos" (se esperan las columnas ID, Owner y Día).')
  }

  const { columns, missing } = resolveColumns(rows[headerIndex])
  if (missing.length > 0) {
    throw new Error(`Faltan columnas en la hoja "Pagos": ${missing.join(', ')}.`)
  }

  const bills: ExpectedBill[] = []
  const issues: string[] = []
  const cell = (row: string[], key: ColumnKey) => String(row[columns[key]] ?? '').trim()

  for (const row of rows.slice(headerIndex + 1)) {
    const id = cell(row, 'id')
    if (!id) continue // fila vacía o de relleno

    const label = `${id} (${cell(row, 'description') || 'sin descripción'})`

    const frequency = parseFrequency(cell(row, 'frequency'))
    if (!frequency) {
      issues.push(`${label}: frecuencia desconocida "${cell(row, 'frequency')}"`)
      continue
    }

    const dayOfMonth = Number(cell(row, 'dayOfMonth'))
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      issues.push(`${label}: día inválido "${cell(row, 'dayOfMonth')}"`)
      continue
    }

    const baseMonth = Number(cell(row, 'baseMonth')) || 0
    if (frequency !== 'Mensual' && (baseMonth < 1 || baseMonth > 12)) {
      issues.push(`${label}: frecuencia ${frequency} requiere un "Mes base" entre 1 y 12`)
      continue
    }

    const from = parseMonthRef(cell(row, 'from'))
    const until = parseMonthRef(cell(row, 'until'))
    if (from === undefined || until === undefined) {
      issues.push(`${label}: fecha Desde/Hasta ilegible (se espera el formato "Sep 2026")`)
      continue
    }

    const amount = cell(row, 'amount')
    if (amountValue(amount) <= 0) {
      issues.push(`${label}: monto inválido "${amount}"`)
      continue
    }

    bills.push({
      id,
      isActive: isYes(cell(row, 'isActive')),
      owner: cell(row, 'owner'),
      category: cell(row, 'category'),
      description: cell(row, 'description'),
      amount,
      paymentMethod: cell(row, 'paymentMethod'),
      isAuto: isYes(cell(row, 'isAuto')),
      dayOfMonth,
      frequency,
      baseMonth,
      customMonths: cell(row, 'customMonths')
        .split(',')
        .map(part => Number(part.trim()))
        .filter(month => Number.isInteger(month) && month >= 1 && month <= 12),
      from,
      until,
    })
  }

  return { bills, issues }
}
