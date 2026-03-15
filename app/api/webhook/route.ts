import { NextRequest, NextResponse } from 'next/server'
import { getMonthData } from '@/lib/sheets'
import { sendMessage } from '@/lib/whatsapp'
import { askClaude } from '@/lib/claude'

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

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

    const currentMonth = MONTH_NAMES[new Date().getMonth()]
    const sheetData = await getMonthData(currentMonth)
    const reply = await askClaude(text, sheetData)

    await sendMessage(from, reply)

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}
