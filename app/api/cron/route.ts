import { NextRequest, NextResponse } from 'next/server'
import { getMonthData, appendExpenses, ensureMonthSheet } from '@/lib/sheets'
import { loadExpected, billsDueOn, isAlreadyLogged, toExpenseRow, type ExpectedBill } from '@/lib/expected'
import { sendMessage } from '@/lib/whatsapp'
import { getNow, getNextDay } from '@/lib/date'
import { formatAmount } from '@/lib/format'

const MY_WHATSAPP_NUMBER = process.env.MY_WHATSAPP_NUMBER!

const billLine = (bill: ExpectedBill, suffix = '') =>
  `• ${bill.description} — ${bill.owner}: ${formatAmount(bill.amount)} (${bill.paymentMethod || 'sin método'})${suffix}\n`

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const { year, month, day: today, monthName: currentMonth } = getNow()
    const todayDate = `${year}/${month}/${today}`
    const tomorrow = getNextDay(year, month, today)

    console.log(`[cron] Running for ${currentMonth} ${today}, date=${todayDate}`)

    await ensureMonthSheet(currentMonth)

    const [{ bills, issues }, expenseRows] = await Promise.all([
      loadExpected(),
      getMonthData(currentMonth),
    ])
    console.log(`[cron] Loaded ${bills.length} expected bills, ${expenseRows?.length ?? 0} expense rows from "${currentMonth}"`)

    // Una fila mal cargada equivale a un recordatorio que nunca llega, así que se avisa.
    if (issues.length > 0) {
      console.error(`[cron] Expected sheet issues:\n${issues.join('\n')}`)
      await sendMessage(
        MY_WHATSAPP_NUMBER,
        `⚠️ *My Pocket Track* — ${issues.length} fila(s) de la hoja *Pagos* no se pudieron leer y quedaron fuera:\n\n${issues.map(i => `• ${i}`).join('\n')}`
      )
    }

    if (bills.length === 0) {
      console.error('[cron] No expected bills found')
      await sendMessage(MY_WHATSAPP_NUMBER, '⚠️ *My Pocket Track* — La hoja de pagos esperados llegó vacía. Revisa la pestaña *Pagos*.')
      return NextResponse.json({ status: 'no data' })
    }

    const todayBills = billsDueOn(bills, year, month, today)
    const tomorrowBills = billsDueOn(bills, tomorrow.year, tomorrow.month, tomorrow.day)

    console.log(`[cron] Total bills: ${bills.length}, today (day ${today}): ${todayBills.length}, tomorrow (${tomorrow.monthName} ${tomorrow.day}): ${tomorrowBills.length}`)

    const autoBills = todayBills.filter(bill => bill.isAuto)
    const manualBills = todayBills.filter(bill => !bill.isAuto && !isAlreadyLogged(bill, expenseRows))
    const alreadyPaidBills = todayBills.filter(bill => !bill.isAuto && isAlreadyLogged(bill, expenseRows))

    console.log(`[cron] Auto bills: ${autoBills.length}, manual bills: ${manualBills.length}, already paid: ${alreadyPaidBills.length}`)

    // Auto-log only automatic bills into the current month expenses sheet
    if (autoBills.length > 0) {
      console.log(`[cron] Auto-logging ${autoBills.length} bills to "${currentMonth}" expense sheet`)
      await appendExpenses(currentMonth, autoBills.map(bill => toExpenseRow(bill, todayDate)))
      console.log('[cron] Auto-log complete')
    }

    if (todayBills.length === 0 && tomorrowBills.length === 0) {
      console.log('[cron] No bills for today or tomorrow, skipping notification')
      return NextResponse.json({ status: 'no bills today' })
    }

    let message = '💰 *My Pocket Track — Recordatorio de pagos*\n\n'

    if (autoBills.length > 0) {
      message += '🤖 *Registrado automáticamente:*\n'
      autoBills.forEach(bill => { message += billLine(bill) })
      message += '\n'
    }

    if (alreadyPaidBills.length > 0) {
      message += '✅ *Ya pagados hoy:*\n'
      alreadyPaidBills.forEach(bill => {
        message += `• ${bill.description} — ${bill.owner}: ${formatAmount(bill.amount)}\n`
      })
      message += '\n'
    }

    if (manualBills.length > 0) {
      message += '⏳ *Pendiente de confirmación:*\n'
      manualBills.forEach(bill => { message += billLine(bill) })
      message += '\nResponde *"Pagué [nombre]"* para registrar cada pago.\n\n'
    }

    if (tomorrowBills.length > 0) {
      message += '⏰ *Mañana toca pagar:*\n'
      tomorrowBills.forEach(bill => { message += billLine(bill, bill.isAuto ? ' 🤖' : '') })
    }

    console.log('[cron] Sending WhatsApp notification...')
    await sendMessage(MY_WHATSAPP_NUMBER, message)
    console.log('[cron] Notification sent successfully')

    return NextResponse.json({ status: 'ok', sent: todayBills.length + tomorrowBills.length })
  } catch (error) {
    console.error('Cron job failed:', error)
    try {
      await sendMessage(MY_WHATSAPP_NUMBER, `❌ *My Pocket Track* — El cron falló. Revisa los logs en Vercel.\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } catch {
      console.error('Failed to send error notification via WhatsApp')
    }
    return NextResponse.json({ status: 'error', error: String(error) }, { status: 500 })
  }
}
