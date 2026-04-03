import { NextRequest, NextResponse } from 'next/server'
import { getMonthData } from '@/lib/sheets'
import { sendMessage } from '@/lib/whatsapp'
import { askClaude } from '@/lib/claude'
import { getNow } from '@/lib/date'

const MY_WHATSAPP_NUMBER = process.env.MY_WHATSAPP_NUMBER!

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const { day: today, monthName: currentMonth } = getNow()

    console.log(`[cron/weekly] Running weekly summary for ${currentMonth}, day ${today}`)

    const sheetData = await getMonthData(currentMonth)

    if (!sheetData || sheetData.length <= 1) {
      console.log(`[cron/weekly] No data found for ${currentMonth}`)
      return NextResponse.json({ status: 'no data' })
    }

    const reply = await askClaude(
      `Genera un resumen semanal de gastos de los últimos 7 días (del día ${Math.max(1, today - 7)} al día ${today}).
       Incluye:
       1. Total gastado en la semana
       2. Desglose por categoría con totales
       3. Top 3 gastos más altos
       4. Si hay alguna categoría que destaque por ser inusualmente alta, menciónalo.
       Formatea el resumen de forma clara y concisa para WhatsApp.`,
      [{ month: currentMonth, data: sheetData }]
    )

    await sendMessage(MY_WHATSAPP_NUMBER, `📊 *Resumen semanal — My Pocket Track*\n\n${reply}`)
    console.log(`[cron/weekly] Weekly summary sent successfully`)

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('Weekly cron failed:', error)
    try {
      await sendMessage(MY_WHATSAPP_NUMBER, `❌ *My Pocket Track* — El resumen semanal falló. Revisa los logs.`)
    } catch {
      console.error('Failed to send error notification')
    }
    return NextResponse.json({ status: 'error', error: String(error) }, { status: 500 })
  }
}
