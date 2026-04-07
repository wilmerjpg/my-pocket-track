import { NextRequest, NextResponse } from 'next/server'
import { getExpectedData, getMonthData, appendExpenses } from '@/lib/sheets'
import { sendMessage } from '@/lib/whatsapp'
import { getNow } from '@/lib/date'

const MY_WHATSAPP_NUMBER = process.env.MY_WHATSAPP_NUMBER!

function isAlreadyLogged(bill: string[], expenseRows: string[][]): boolean {
  return expenseRows.some(expense =>
    expense[0]?.toLowerCase() === bill[0]?.toLowerCase() &&
    expense[4]?.toLowerCase() === bill[4]?.toLowerCase()
  )
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const { year, month, day: today, monthName: currentMonth } = getNow()
    const todayDate = `${year}/${month}/${today}`
    const tomorrow = today + 1

    console.log(`[cron] Running for ${currentMonth} ${today}, date=${todayDate}`)

    const [rows, expenseRows] = await Promise.all([
      getExpectedData(currentMonth),
      getMonthData(currentMonth),
    ])
    console.log(`[cron] Fetched ${rows?.length ?? 0} expected rows, ${expenseRows?.length ?? 0} expense rows from "${currentMonth}"`)


    if (!rows || rows.length <= 1) {
      console.error(`[cron] No data found for month: ${currentMonth}`)
      await sendMessage(MY_WHATSAPP_NUMBER, `⚠️ *My Pocket Track* — No se encontraron datos para ${currentMonth}. Revisa la hoja de pagos esperados.`)
      return NextResponse.json({ status: 'no data', month: currentMonth })
    }

    // Skip header row, filter by day (col H = index 7)
    const allBills = rows.slice(1).filter(row => row[0])
    const todayBills = allBills.filter(row => Number(row[7]) === today)
    const tomorrowBills = allBills.filter(row => Number(row[7]) === tomorrow)

    console.log(`[cron] Total bills: ${allBills.length}, today (day ${today}): ${todayBills.length}, tomorrow (day ${tomorrow}): ${tomorrowBills.length}`)

    // Split today's bills into auto and manual
    const autoBills = todayBills.filter(row => row[6]?.toLowerCase() === 'yes')
    const allManualBills = todayBills.filter(row => row[6]?.toLowerCase() !== 'yes')
    const manualBills = allManualBills.filter(row => !isAlreadyLogged(row, expenseRows))
    const alreadyPaidBills = allManualBills.filter(row => isAlreadyLogged(row, expenseRows))

    console.log(`[cron] Auto bills: ${autoBills.length}, manual bills: ${manualBills.length}, already paid: ${alreadyPaidBills.length}`)

    // Auto-log only automatic bills into the current month expenses sheet
    if (autoBills.length > 0) {
      console.log(`[cron] Auto-logging ${autoBills.length} bills to "${currentMonth}" expense sheet`)
      await appendExpenses(currentMonth, autoBills.map(row => [
        row[0], // Owner
        row[1], // Category
        row[2], // Type
        row[3], // By Method
        row[4], // Description
        row[5], // Amount
        todayDate, // Date (year/month/day)
      ]))
      console.log(`[cron] Auto-log complete`)
    }

    if (todayBills.length === 0 && tomorrowBills.length === 0) {
      console.log(`[cron] No bills for today or tomorrow, skipping notification`)
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

    if (alreadyPaidBills.length > 0) {
      message += '✅ *Ya pagados hoy:*\n'
      alreadyPaidBills.forEach(row => {
        message += `• ${row[4]} — ${row[0]}: $${row[5]}\n`
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

    console.log(`[cron] Sending WhatsApp notification...`)
    await sendMessage(MY_WHATSAPP_NUMBER, message)
    console.log(`[cron] Notification sent successfully`)

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
