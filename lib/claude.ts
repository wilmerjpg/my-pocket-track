import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function askClaude(userMessage: string, sheetData: string[][]) {
  const dataRows = sheetData
    .slice(1)
    .filter((row) => {
      // Summary rows have no category (col B is empty)
      if (!row[0] || !row[1]) return false;
      return true;
    })
    .map((row) => ({
      owner: row[0],
      category: row[1],
      type: row[2],
      paymentMethod: row[3],
      description: row[4],
      amount: row[5],
      auto: row[6],
      day: row[7],
    }));

  const now = new Date();
  const todayDay = now.getDate();
  const currentMonth = now.toLocaleString("en-US", { month: "long" });

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Eres un asistente financiero personal llamado My Pocket Track.
Hoy es el día ${todayDay} de ${currentMonth}.

Aquí están los datos:

${JSON.stringify(dataRows, null, 2)}

El usuario pregunta: "${userMessage}"

Contexto del sistema:
- Owners válidos: Nosotros, Lisbeth, Tete, Oriana, Veronica, Wilmer Padre, Brigida
- "Nosotros" significa gastos compartidos (Wilmer + Yanelly)
- "Wilmer Padre" y "Wilmer padre" son el mismo owner (ignora mayúsculas al filtrar)
- Categorías: Servicio, Comida, Salud, Simba, Articulos Personales, Personal, Inversiones, Seguro
- Métodos de pago: Card, BofA Yanelly, BofA Wilmer, Cash, Payoneer, Paypal, Banesco Panama, TDC Mercantil W

Instrucciones:
- Responde de forma concisa y en el mismo idioma que el usuario (español o inglés)
- Si preguntan por totales, suma los montos correctamente
- Si preguntan por categorías específicas, filtra y suma
- Si preguntan por una persona, filtra por owner ignorando mayúsculas/minúsculas
- Si preguntan por pagos próximos o pendientes, muestra SOLO los que tienen day > ${todayDay} en el mes actual (${currentMonth}), ordénalos por día ascendente. NO menciones el próximo mes a menos que el usuario lo pida explícitamente
- Todos los montos son en USD
- Usa emojis para hacer la respuesta más amigable
- Sé breve, máximo 3-4 líneas de respuesta`,
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

type ConfirmationResult =
  | { matched: "items"; items: { description: string; owner: string }[] }
  | { matched: "all" }
  | { matched: "ambiguous"; options: { description: string; owner: string; amount: string }[] }
  | { matched: false }

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

export async function parsePaymentConfirmation(
  userMessage: string,
  pendingBills: string[][]
): Promise<ConfirmationResult> {
  const bills = pendingBills
    .slice(1)
    .filter((row) => row[0] && row[1])
    .map((row) => ({
      description: row[4],
      owner: row[0],
      amount: row[5],
    }))

  if (bills.length === 0) return { matched: false }

  const billList = bills
    .map((b, i) => `${i + 1}. "${b.description}" — ${b.owner} ($${b.amount})`)
    .join("\n")

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `The user confirmed a payment with this message: "${userMessage}"

Pending bills:
${billList}

Match the user's message to bills above. Rules:
- If the user wants to pay ALL pending bills (e.g. "paid everything", "pagué todo", "all payments") → return: {"matched":"all"}
- If the user mentions one or more specific bills that all match unambiguously → return: {"matched":"items","items":[{"description":"...","owner":"..."},{"description":"...","owner":"..."}]}
- If a description matches multiple owners and the user didn't specify which → return: {"matched":"ambiguous","options":[{"description":"...","owner":"...","amount":"..."},...]}
- If no match or unclear → return: {"matched":false}

Respond with JSON only, no other text.`,
      },
    ],
  })

  const text = response.content[0].type === "text" ? response.content[0].text : ""
  const parsed = extractJson(text) as ConfirmationResult | null
  return parsed ?? { matched: false }
}
