import { NextRequest, NextResponse } from 'next/server'
import { getExpectedData, appendExpense } from '@/lib/sheets'
import { sendMessage } from '@/lib/whatsapp'

const MY_WHATSAPP_NUMBER = process.env.MY_WHATSAPP_NUMBER!

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const now = new Date()
  const today = now.getDate()
  const tomorrow = today + 1
  const currentMonth = MONTH_NAMES[now.getMonth()]

  const rows = await getExpectedData(currentMonth)

  // Skip header row, filter by day (col H = index 7)
  const allBills = rows.slice(1).filter(row => row[0])
  const todayBills = allBills.filter(row => Number(row[7]) === today)
  const tomorrowBills = allBills.filter(row => Number(row[7]) === tomorrow)

  // Split today's bills into auto and manual
  const autoBills = todayBills.filter(row => row[6]?.toLowerCase() === 'yes')
  const manualBills = todayBills.filter(row => row[6]?.toLowerCase() !== 'yes')

  // Auto-log only automatic bills into the current month expenses sheet
  if (autoBills.length > 0) {
    await Promise.all(
      autoBills.map(row =>
        appendExpense(currentMonth, [
          row[0], // Owner
          row[1], // Category
          row[2], // Type
          row[3], // By Method
          row[4], // Description
          row[5], // Amount
          String(today), // Date (day of month)
        ])
      )
    )
  }

  if (todayBills.length === 0 && tomorrowBills.length === 0) {
    return NextResponse.json({ status: 'no bills today' })
  }

  let message = '💰 *My Pocket Track — Recordatorio de pagos*\n\n'

  if (autoBills.length > 0) {
    message += '🤖 *Registrado automáticamente:*\n'
    autoBills.forEach(row => {
      message += `• ${row[4]} — ${row[0]}: $${row[5]} (${row[3]})\n`
    })
    message += '\n'
  }

  if (manualBills.length > 0) {
    message += '⏳ *Pendiente de confirmación:*\n'
    manualBills.forEach(row => {
      message += `• ${row[4]} — ${row[0]}: $${row[5]} (${row[3]})\n`
    })
    message += '\nResponde *"Pagué [nombre]"* para registrar cada pago.\n\n'
  }

  if (tomorrowBills.length > 0) {
    message += '⏰ *Mañana toca pagar:*\n'
    tomorrowBills.forEach(row => {
      const auto = row[6]?.toLowerCase() === 'yes' ? ' 🤖' : ''
      message += `• ${row[4]} — ${row[0]}: $${row[5]} (${row[3]})${auto}\n`
    })
  }

  await sendMessage(MY_WHATSAPP_NUMBER, message)

  return NextResponse.json({ status: 'ok', sent: todayBills.length + tomorrowBills.length })
}
