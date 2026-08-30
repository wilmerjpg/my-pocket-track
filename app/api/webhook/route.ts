import { NextRequest, NextResponse, after } from 'next/server'
import { getMonthData, toExpenseRecords, appendExpense, appendExpenses, deleteLastExpense, updateLastExpenseAmount } from '@/lib/sheets'
import { loadExpected, billsForMonth, dueDayIn, toExpenseRow, toClaudeRecord } from '@/lib/expected'
import { sendMessage, downloadMedia } from '@/lib/whatsapp'
import { transcribeAudio } from '@/lib/transcribe'
import { askClaude, parsePaymentConfirmation, parseExpenseMessage } from '@/lib/claude'
import { getNow, getPreviousMonth, getMonthNumber } from '@/lib/date'
import { formatAmount } from '@/lib/format'

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === retries) throw err
      await new Promise(res => setTimeout(res, delayMs * attempt))
    }
  }
  throw new Error('unreachable')
}

const confirmationKeywords = ['pagué', 'pague', 'ya pagué', 'ya pague', 'paid', 'i paid', 'cancelé', 'cancele', 'confirmo']
const expectedKeywords = ['expected', 'upcoming', 'incoming', 'bills', 'payments', 'pagos', 'próximos', 'proximos', 'pendientes', 'pendiente', 'debo pagar', 'toca pagar', 'se paga', 'hay que pagar', 'queda del mes', 'resto del mes', 'falta pagar', 'falta por pagar', 'por pagar', 'mañana', 'tomorrow']
const registerKeywords = ['registra', 'registro', 'anota', 'agrega', 'añade', 'añadir', 'agregar', 'register', 'add expense', 'log expense', 'gasto de', 'gastos de']
const deleteKeywords = ['elimina', 'borra', 'delete', 'undo', 'deshacer', 'eliminar último', 'borrar último', 'eliminar ultimo', 'borrar ultimo']
const correctKeywords = ['corrige', 'corrección', 'correccion', 'correct', 'fix amount', 'cambia el monto', 'cambiar monto']

// Maps Spanish and English month keywords to canonical English month names
const MONTH_KEYWORD_MAP: Record<string, string> = {
  'enero': 'January',    'january': 'January',
  'febrero': 'February', 'february': 'February',
  'marzo': 'March',      'march': 'March',
  'abril': 'April',      'april': 'April',
  'mayo': 'May',         // 'may' skipped in English — too ambiguous
  'junio': 'June',       'june': 'June',
  'julio': 'July',       'july': 'July',
  'agosto': 'August',    'august': 'August',
  'septiembre': 'September', 'september': 'September',
  'octubre': 'October',  'october': 'October',
  'noviembre': 'November', 'november': 'November',
  'diciembre': 'December', 'december': 'December',
}

const RELATIVE_MONTH_KEYWORDS = ['mes pasado', 'last month', 'mes anterior', 'previous month']

function detectMonths(text: string, currentMonth: string): string[] {
  const lower = text.toLowerCase()
  const found = new Set<string>([currentMonth])
  for (const [keyword, monthName] of Object.entries(MONTH_KEYWORD_MAP)) {
    if (lower.includes(keyword)) found.add(monthName)
  }
  if (RELATIVE_MONTH_KEYWORDS.some(kw => lower.includes(kw))) {
    found.add(getPreviousMonth(currentMonth))
  }
  return Array.from(found)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// In-memory dedup cache. WhatsApp retries the webhook if we don't 200 fast enough,
// so the same message.id can arrive multiple times on the same warm instance.
const processedMessageIds = new Set<string>()
const MAX_PROCESSED_IDS = 1000

function markProcessed(id: string) {
  processedMessageIds.add(id)
  if (processedMessageIds.size > MAX_PROCESSED_IDS) {
    const first = processedMessageIds.values().next().value
    if (first) processedMessageIds.delete(first)
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]

  if (!message?.id) return NextResponse.json({ status: 'ok' })

  if (processedMessageIds.has(message.id)) {
    console.log(`[webhook] Skipping duplicate message ${message.id}`)
    return NextResponse.json({ status: 'duplicate' })
  }
  markProcessed(message.id)

  // Respond 200 immediately so WhatsApp doesn't retry; do the heavy work after.
  after(processIncomingMessage(message))

  return NextResponse.json({ status: 'ok' })
}

async function processIncomingMessage(message: { id: string; from: string; type: string; text?: { body: string }; audio?: { id: string } }) {
  try {
    if (message.type !== 'text' && message.type !== 'audio') return

    const from: string = message.from
    let text: string

    if (message.type === 'audio' && message.audio) {
      try {
        const audioBuffer = await downloadMedia(message.audio.id)
        text = await transcribeAudio(audioBuffer)
        await sendMessage(from, `🎙️ _Transcripción: "${text}"_`)
      } catch (err) {
        console.error('Audio transcription failed:', err)
        await sendMessage(from, '❌ No pude procesar la nota de voz. Intenta enviarlo como texto.')
        return
      }
    } else if (message.text) {
      text = message.text.body
    } else {
      return
    }

    const lowerText = text.toLowerCase()
    const { year, month, day: today, monthName: currentMonth } = getNow()
    const todayDate = `${year}/${month}/${today}`

    // Branch 1 — Payment confirmation (checked before register so phrases like
    // "ya pagué todos los gastos de hoy" aren't misrouted by "gastos de").
    if (confirmationKeywords.some(k => lowerText.includes(k))) {
      const { bills } = await loadExpected()
      const manualBills = billsForMonth(bills, year, month).filter(bill => !bill.isAuto)
      const byId = new Map(manualBills.map(bill => [bill.id, bill]))
      const todayManual = manualBills.filter(bill => dueDayIn(bill, year, month) === today)

      const result = await parsePaymentConfirmation(text, manualBills)

      const logBills = async (toLog: typeof manualBills) => {
        await appendExpenses(currentMonth, toLog.map(bill => toExpenseRow(bill, todayDate)))
        const list = toLog.map(b => `• ${b.description} — ${b.owner}: ${formatAmount(b.amount)}`).join('\n')
        await sendMessage(from, `✅ *${toLog.length} pago(s) registrado(s)!*\n${list}`)
      }

      if (result.matched === 'all') {
        if (todayManual.length === 0) {
          await sendMessage(from, 'No tienes pagos manuales pendientes para hoy.')
        } else {
          await logBills(todayManual)
        }
      } else if (result.matched === 'items') {
        // Los IDs vienen de un modelo, así que se validan contra la hoja antes de escribir.
        const toLog = result.ids.map(id => byId.get(id)).filter(Boolean) as typeof manualBills
        if (toLog.length === 0) {
          await sendMessage(from, 'No pude identificar el pago. Intenta con el nombre exacto.')
        } else {
          await logBills(toLog)
        }
      } else if (result.matched === 'ambiguous') {
        const options = result.ids.map(id => byId.get(id)).filter(Boolean) as typeof manualBills
        const optionsList = options
          .map(o => `• ${o.description} — ${o.owner}: ${formatAmount(o.amount)} (día ${dueDayIn(o, year, month)})`)
          .join('\n')
        await sendMessage(from, `¿Cuál de estos?\n\n${optionsList}\n\nResponde indicando el owner o el monto.`)
      } else {
        const hint = todayManual.length > 0
          ? '\n\nPendientes de hoy:\n' + todayManual.map(b => `• ${b.description} — ${b.owner}`).join('\n')
          : ''
        await sendMessage(from, `No pude identificar el pago. Intenta con el nombre exacto.${hint}`)
      }

      return
    }

    // Branch 0 — Register new ad-hoc expense
    if (registerKeywords.some(k => lowerText.includes(k))) {
      try {
        const expense = await parseExpenseMessage(text)
        if (!expense) {
          await sendMessage(from, '❌ No pude entender el gasto. Asegúrate de incluir el owner y el monto.\n\nEjemplo: _Registra $50 de comida para Tete, pizza_')
        } else {
          await withRetry(() => appendExpense(currentMonth, [
            expense.owner,
            expense.category,
            expense.type,
            expense.paymentMethod,
            expense.description,
            expense.amount,
            todayDate,
          ]))
          await sendMessage(from,
            `✅ *Gasto registrado correctamente:*\n\n` +
            `• *Owner:* ${expense.owner}\n` +
            `• *Categoría:* ${expense.category}\n` +
            `• *Descripción:* ${expense.description}\n` +
            `• *Monto:* ${formatAmount(expense.amount)}\n` +
            `• *Tipo:* ${expense.type}\n` +
            `• *Método de pago:* ${expense.paymentMethod}\n` +
            `• *Fecha:* ${today}/${month}/${year}`
          )
        }
      } catch (err) {
        console.error('Register expense failed:', err)
        const detail = err instanceof Error ? err.message : String(err)
        await sendMessage(from, `❌ *Error al registrar el gasto.*\n\n\`${detail}\``)
      }
      return
    }

    // Branch 0.5 — Delete or correct last expense
    if (deleteKeywords.some(k => lowerText.includes(k))) {
      try {
        const deleted = await deleteLastExpense(currentMonth)
        if (deleted) {
          await sendMessage(from,
            `🗑️ *Último gasto eliminado:*\n\n` +
            `• *Owner:* ${deleted[0]}\n` +
            `• *Categoría:* ${deleted[1]}\n` +
            `• *Descripción:* ${deleted[4]}\n` +
            `• *Monto:* ${formatAmount(deleted[5])}\n` +
            `• *Fecha:* ${deleted[6]}`
          )
        } else {
          await sendMessage(from, '❌ No hay gastos registrados este mes para eliminar.')
        }
      } catch {
        await sendMessage(from, '❌ Error al eliminar el gasto. Intenta de nuevo.')
      }
      return
    }

    if (correctKeywords.some(k => lowerText.includes(k))) {
      const amountMatch = lowerText.match(/\$?\s*(\d+(?:\.\d+)?)/)
      if (!amountMatch) {
        await sendMessage(from, '❌ No pude identificar el nuevo monto. Ejemplo: _Corrige el monto a $50_')
      } else {
        try {
          const original = await updateLastExpenseAmount(currentMonth, amountMatch[1])
          if (original) {
            await sendMessage(from,
              `✏️ *Monto corregido:*\n\n` +
              `• *Descripción:* ${original[4]}\n` +
              `• *Monto anterior:* ${formatAmount(original[5])}\n` +
              `• *Nuevo monto:* ${formatAmount(amountMatch[1])}`
            )
          } else {
            await sendMessage(from, '❌ No hay gastos registrados este mes para corregir.')
          }
        } catch {
          await sendMessage(from, '❌ Error al corregir el monto. Intenta de nuevo.')
        }
      }
      return
    }

    // Branch 2 — Expected payments query
    if (expectedKeywords.some(k => lowerText.includes(k))) {
      const { bills } = await loadExpected()
      const records = detectMonths(lowerText, currentMonth).flatMap(monthName => {
        const monthNumber = getMonthNumber(monthName)
        return billsForMonth(bills, year, monthNumber).map(bill => toClaudeRecord(bill, year, monthNumber))
      })
      const reply = await askClaude(text, records)
      await sendMessage(from, reply)
      return
    }

    // Branch 3 — General expenses query (fallback, multi-month)
    const months = detectMonths(lowerText, currentMonth)
    const monthsData = await Promise.all(
      months.map(async month => toExpenseRecords(month, await getMonthData(month)))
    )
    const reply = await askClaude(text, monthsData.flat())
    await sendMessage(from, reply)
  } catch (error) {
    console.error('Webhook processing error:', error)
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    try {
      await sendMessage(message.from, `❌ Error procesando el mensaje.\n\n\`${detail}\``)
    } catch {
      // ignore — notification failure is best-effort
    }
  }
}
