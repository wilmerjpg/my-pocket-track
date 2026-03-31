import axios from 'axios'

export async function sendMessage(to: string, message: string) {
  try {
    const response = await axios.post(
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
    console.log('[whatsapp] API response:', JSON.stringify(response.data, null, 2))
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      console.error('[whatsapp] API error:', JSON.stringify(error.response?.data, null, 2))
    }
    throw error
  }
}
