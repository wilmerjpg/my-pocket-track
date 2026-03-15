import axios from 'axios'

export async function sendMessage(to: string, message: string) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    )
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      console.error('WhatsApp API error:', JSON.stringify(error.response?.data, null, 2))
    }
    throw error
  }
}
