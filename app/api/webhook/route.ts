import { NextRequest, NextResponse } from 'next/server'
import { getMonthData, getExpectedData, appendExpense } from '@/lib/sheets'
import { sendMessage } from '@/lib/whatsapp'
import { askClaude, parsePaymentConfirmation } from '@/lib/claude'

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const confirmationKeywords = ['pagué', 'pague', 'ya pagué', 'ya pague', 'paid', 'i paid', 'cancelé', 'cancele', 'confirmo']
const expectedKeywords = ['expected', 'upcoming', 'incoming', 'bills', 'payments', 'pagos', 'próximos', 'proximos', 'pendientes', 'debo pagar', 'toca pagar']

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

export async function POST(req: NextRequest) {
  const body = await req.json()

  try {
    const entry = body.entry?.[0]
    const change = entry?.changes?.[0]
    const message = change?.value?.messages?.[0]

    if (!message || message.type !== 'text') {
      return NextResponse.json({ status: 'ok' })
    }

    const from: string = message.from
    const text: string = message.text.body
    const lowerText = text.toLowerCase()
    const currentMonth = MONTH_NAMES[new Date().getMonth()]
    const today = new Date().getDate()

    // Branch 1 — Payment confirmation
    if (confirmationKeywords.some(k => lowerText.includes(k))) {
      const expectedRows = await getExpectedData(currentMonth)
      const nonAutoBills = expectedRows.filter((row, i) => i === 0 || (row[0] && row[6]?.toLowerCase() !== 'yes'))

      const result = await parsePaymentConfirmation(text, nonAutoBills)

      if (result.matched === 'all') {
        // Log all today's non-auto bills
        const todayManual = expectedRows.slice(1).filter(
          row => row[0] && row[6]?.toLowerCase() !== 'yes' && Number(row[7]) === today
        )
        if (todayManual.length === 0) {
          await sendMessage(from, 'No tienes pagos manuales pendientes para hoy.')
        } else {
          await Promise.all(todayManual.map(row =>
            appendExpense(currentMonth, [row[0], row[1], row[2], row[3], row[4], row[5], String(today)])
          ))
          const list = todayManual.map(r => `• ${r[4]} — ${r[0]}: $${r[5]}`).join('\n')
          await sendMessage(from, `✅ *${todayManual.length} pagos registrados!*\n${list}`)
        }
      } else if (result.matched === 'items') {
        // Log each matched bill
        const loggedRows = result.items.map(item =>
          expectedRows.slice(1).find(
            row => row[4]?.toLowerCase() === item.description.toLowerCase() &&
                   row[0]?.toLowerCase() === item.owner.toLowerCase()
          )
        ).filter(Boolean) as string[][]

        await Promise.all(loggedRows.map(row =>
          appendExpense(currentMonth, [row[0], row[1], row[2], row[3], row[4], row[5], String(today)])
        ))
        const list = loggedRows.map(r => `• ${r[4]} — ${r[0]}: $${r[5]}`).join('\n')
        await sendMessage(from, `✅ *${loggedRows.length} pago(s) registrado(s)!*\n${list}`)
      } else if (result.matched === 'ambiguous') {
        const optionsList = result.options.map(o => `• ${o.description} — ${o.owner}: $${o.amount}`).join('\n')
        await sendMessage(from, `¿"${result.options[0].description}" de quién?\n\n${optionsList}\n\nResponde con el nombre del owner para confirmar.`)
      } else {
        // No match — list today's pending manual bills as hints
        const todayManual = expectedRows.slice(1).filter(
          row => row[0] && row[6]?.toLowerCase() !== 'yes' && Number(row[7]) === today
        )
        const hint = todayManual.length > 0
          ? '\n\nPendientes de hoy:\n' + todayManual.map(r => `• ${r[4]} — ${r[0]}`).join('\n')
          : ''
        await sendMessage(from, `No pude identificar el pago. Intenta con el nombre exacto.${hint}`)
      }

      return NextResponse.json({ status: 'ok' })
    }

    // Branch 2 — Expected payments query
    if (expectedKeywords.some(k => lowerText.includes(k))) {
      const sheetData = await getExpectedData(currentMonth)
      const reply = await askClaude(text, sheetData)
      await sendMessage(from, reply)
      return NextResponse.json({ status: 'ok' })
    }

    // Branch 3 — General expenses query (fallback)
    const sheetData = await getMonthData(currentMonth)
    const reply = await askClaude(text, sheetData)
    await sendMessage(from, reply)

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}
