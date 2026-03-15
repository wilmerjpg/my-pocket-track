import { NextRequest, NextResponse } from 'next/server'
import { sendMessage } from '@/lib/whatsapp'

const MY_WHATSAPP_NUMBER = process.env.MY_WHATSAPP_NUMBER!

// Recurring bills config — day of month: list of bills
const RECURRING_BILLS: Record<number, { name: string; amount: number; currency: string; method: string }[]> = {
  1: [
    { name: 'Spotify', amount: 6, currency: 'US', method: 'Card' },
    { name: 'Hushed Yanelly', amount: 5, currency: 'US', method: 'BofA Yanelly' },
    { name: 'Power Link (Lisbeth)', amount: 30, currency: 'VES', method: 'Cash' },
    { name: 'Power Link (Tete)', amount: 30, currency: 'VES', method: 'Cash' },
    { name: 'VNET Internet Ricci', amount: 30, currency: 'VES', method: 'Cash' },
    { name: 'Condominio Nuevos Altos', amount: 72, currency: 'VES', method: 'Cash' },
    { name: 'Comisiones Payoneer', amount: 150, currency: 'US', method: 'Payoneer' },
  ],
  2: [
    { name: 'Inter (Lisbeth)', amount: 9, currency: 'VES', method: 'Cash' },
    { name: 'Inter (Nosotros)', amount: 42, currency: 'VES', method: 'Cash' },
    { name: 'WOW Internet', amount: 30, currency: 'VES', method: 'Cash' },
    { name: 'Ricci condominio', amount: 60, currency: 'VES', method: 'Cash' },
    { name: 'Inversiones Payoneer (BTC/ETH/SOL/BNB/ADA)', amount: 1100, currency: 'US', method: 'Payoneer' },
  ],
  5: [
    { name: 'IBKR', amount: 1500, currency: 'US', method: 'BofA Wilmer' },
    { name: 'iCloud Wilmer', amount: 3, currency: 'US', method: 'BofA Wilmer' },
    { name: 'Movistar Wilmer padre', amount: 4, currency: 'VES', method: 'Cash' },
    { name: 'Digitel Wilmer', amount: 15, currency: 'VES', method: 'Cash' },
  ],
  9: [
    { name: 'Ventu / Inversiones Banesco Panama', amount: 1385.01, currency: 'US', method: 'Banesco Panama' },
    { name: 'Apple Care Yanelly iPhone', amount: 10, currency: 'USD', method: 'BofA Wilmer' },
  ],
  13: [
    { name: 'Netflix', amount: 14, currency: 'US', method: 'TDC Mercantil W' },
  ],
  15: [
    { name: 'ChatGPT', amount: 20, currency: 'US', method: 'BofA Wilmer' },
  ],
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const today = new Date().getDate()
  const tomorrow = today + 1

  const todayBills = RECURRING_BILLS[today] || []
  const tomorrowBills = RECURRING_BILLS[tomorrow] || []

  if (todayBills.length === 0 && tomorrowBills.length === 0) {
    return NextResponse.json({ status: 'no bills today' })
  }

  let message = '💰 *My Pocket Track — Recordatorio de pagos*\n\n'

  if (todayBills.length > 0) {
    message += '📅 *Hoy toca pagar:*\n'
    todayBills.forEach(bill => {
      message += `• ${bill.name}: $${bill.amount} ${bill.currency} (${bill.method})\n`
    })
    message += '\n'
  }

  if (tomorrowBills.length > 0) {
    message += '⏰ *Mañana toca pagar:*\n'
    tomorrowBills.forEach(bill => {
      message += `• ${bill.name}: $${bill.amount} ${bill.currency} (${bill.method})\n`
    })
  }

  await sendMessage(MY_WHATSAPP_NUMBER, message)

  return NextResponse.json({ status: 'ok', sent: todayBills.length + tomorrowBills.length })
}
