import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function askClaude(userMessage: string, sheetData: string[][]) {
  const summaryKeywords = ['total', 'inversiones', 'seguros', 'servicios', 'comida nosotros', 'lisbeth', 'extra']

  const dataRows = sheetData
    .slice(1)
    .filter(row => {
      if (!row[0]) return false
      const firstCell = row[0].toLowerCase()
      return !summaryKeywords.some(k => firstCell.startsWith(k))
    })
    .map(row => ({
      owner: row[0],
      category: row[1],
      type: row[2],
      paymentMethod: row[3],
      description: row[4],
      amount: row[5],
      date: row[7],
    }))

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Eres un asistente financiero personal llamado My Pocket Track.
Aquí están los gastos del mes actual:

${JSON.stringify(dataRows, null, 2)}

El usuario pregunta: "${userMessage}"

Instrucciones:
- Responde de forma concisa y en el mismo idioma que el usuario (español o inglés)
- Si preguntan por totales, suma los montos correctamente
- Si preguntan por categorías específicas (comida, inversiones, servicios, etc.), filtra y suma
- Si preguntan por una persona específica (Lisbeth, Nosotros, etc.), filtra por owner
- Todos los montos son en USD
- Usa emojis para hacer la respuesta más amigable
- Sé breve, máximo 3-4 líneas de respuesta`,
      },
    ],
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}
