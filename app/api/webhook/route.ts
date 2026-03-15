import { NextRequest, NextResponse } from 'next/server'
import { getMonthData, getExpectedData } from '@/lib/sheets'
import { sendMessage } from '@/lib/whatsapp'
import { askClaude } from '@/lib/claude'

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN

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

    const expectedKeywords = ['expected', 'upcoming', 'incoming', 'bills', 'payments', 'pagos', 'próximos', 'proximos', 'pendientes', 'debo pagar', 'toca pagar']
    const isExpectedQuery = expectedKeywords.some(k => text.toLowerCase().includes(k))

    const sheetData = isExpectedQuery
      ? await getExpectedData()
      : await getMonthData(new Date().toLocaleString('en-US', { month: 'long' }))

    const reply = await askClaude(text, sheetData)

    await sendMessage(from, reply)

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}
