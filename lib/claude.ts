import Anthropic from "@anthropic-ai/sdk";
import { getNow } from "@/lib/date";
import type { ExpectedBill } from "@/lib/expected";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Responde una pregunta del usuario sobre sus finanzas.
 *
 * Recibe los registros ya interpretados — el orden de columnas de cada hoja se
 * resuelve en `lib/sheets.ts` y `lib/expected.ts`, no aquí.
 */
export async function askClaude(
  userMessage: string,
  records: Record<string, unknown>[]
) {
  const allRows = records;

  const { day: todayDay, monthName: currentMonth } = getNow();

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Eres un asistente financiero personal llamado My Pocket Track.
Hoy es el día ${todayDay} de ${currentMonth}.

Aquí están los datos financieros (el campo "month" indica a qué mes pertenece cada fila):

${JSON.stringify(allRows, null, 2)}

El usuario pregunta: "${userMessage}"

Contexto del sistema:
- Owners válidos: Nosotros, Lisbeth, Tete, Oriana, Veronica, Wilmer Padre, Brigida, Juan
- "Nosotros" significa gastos compartidos (Wilmer + Yanelly)
- "Wilmer Padre" y "Wilmer padre" son el mismo owner (ignora mayúsculas al filtrar)
- Categorías: Servicio, Comida, Salud, Simba, Articulos Personales, Personal, Inversiones, Seguro, Hogar
- Métodos de pago: Card, BofA Yanelly, BofA Wilmer, Cash, Payoneer, Paypal, Banesco Panama, TDC Mercantil W

Instrucciones:
- Responde de forma concisa y en el mismo idioma que el usuario (español o inglés)
- Si preguntan por totales, suma los montos correctamente
- Si preguntan por categorías específicas, filtra y suma
- Si preguntan por una persona, filtra por owner ignorando mayúsculas/minúsculas
- Si preguntan por pagos próximos o pendientes del mes actual, muestra los que tienen day > ${todayDay} y month = "${currentMonth}", ordénalos por día ascendente
- Si preguntan por un día o fecha específica (ej: "el 2 de abril"), filtra por el month y day correctos según lo pedido
- Los datos pueden incluir múltiples meses; filtra por el campo "month" según lo que pida el usuario
- Si el usuario pregunta por "mes pasado" o un mes específico, filtra los datos por ese month
- Si preguntan por categorías, agrupa y suma por categoría
- Todos los montos son en USD
- Usa emojis para hacer la respuesta más amigable
- Sé breve, máximo 3-4 líneas de respuesta`,
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

export type ParsedExpense = {
  owner: string
  category: string
  type: string
  paymentMethod: string
  description: string
  amount: string
}

export async function parseExpenseMessage(userMessage: string): Promise<ParsedExpense | null> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `Extract expense details from this message: "${userMessage}"

Valid owners: Nosotros, Lisbeth, Tete, Oriana, Veronica, Wilmer Padre, Brigida, Juan
Valid categories: Servicio, Comida, Salud, Simba, Articulos Personales, Personal, Inversiones, Seguro, Hogar
Valid payment methods: Card, BofA Yanelly, BofA Wilmer, Cash, Payoneer, Paypal, Banesco Panama, TDC Mercantil W

Business-specific defaults (apply these first, user-provided values override):
- "gimnasio" → Owner: Nosotros, Amount: 100, Category: Personal, Type: Fijo, Payment: Cash
- "Más por Menos" / "Mas por Menos" / "Gama" (supermarkets) → Category: Comida
- "Farmatodo" → Category: Salud by default; Category: Comida if food items are mentioned (e.g. "comida", "snacks", "bebidas")
- "colegio" when owner is Oriana → Category: Servicio
- "IBKR" / "Interactive Brokers" → Category: Inversiones, Payment: BofA Wilmer

General rules:
- Match owner case-insensitively to one of the valid owners (e.g. "tete" → "Tete")
- Match category case-insensitively (e.g. "salud" → "Salud")
- If the message contains the word "personal" (e.g. "gasto personal", "personal expense"), category MUST be "Personal" regardless of what the expense is about
- If payment method not mentioned and no business rule applies, default to "Cash"
- Amount must be a number (no currency symbol)
- Description: short phrase describing the actual expense item, do NOT include category-indicator words like "personal", "gasto personal", etc. (e.g. "gasto personal en panadería" → description is "panadería")
- If owner or amount is missing/unclear AND no business rule provides a default, return {"matched": false}
- Type: "Comida" → "Fijo", "Servicio" → "Fijo", "Inversiones" → "Fijo", "Seguro" → "Fijo", otherwise → "Extra". Business-specific Type overrides this.

Return JSON only:
{"matched":true,"owner":"...","category":"...","type":"...","paymentMethod":"...","description":"...","amount":"..."}
or {"matched":false}`,
      },
    ],
  })

  const text = response.content[0].type === "text" ? response.content[0].text : ""
  const parsed = extractJson(text) as ({ matched: true } & ParsedExpense) | { matched: false } | null
  if (!parsed || !parsed.matched) return null
  const { matched: _, ...expense } = parsed
  return expense as ParsedExpense
}

type ConfirmationResult =
  | { matched: "items"; ids: string[] }
  | { matched: "all" }
  | { matched: "ambiguous"; ids: string[] }
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

/**
 * Empareja el mensaje del usuario ("ya pagué el colegio") con los pagos pendientes.
 *
 * Devuelve IDs y no owner+descripción porque ese par no es único: P013 y P040
 * son ambos "Wilmer Padre / Comida" y solo se distinguen por monto y día.
 */
export async function parsePaymentConfirmation(
  userMessage: string,
  pendingBills: ExpectedBill[]
): Promise<ConfirmationResult> {
  if (pendingBills.length === 0) return { matched: false };

  const billList = pendingBills
    .map((b) => `${b.id}: "${b.description}" — ${b.owner} (${b.amount}, día ${b.dayOfMonth})`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `The user confirmed a payment with this message: "${userMessage}"

Pending bills (each line starts with its ID):
${billList}

Match the user's message to bills above. Always refer to bills by their ID. Rules:
- If the user wants to pay ALL pending bills (e.g. "paid everything", "pagué todo", "all payments") → return: {"matched":"all"}
- If the user mentions one or more specific bills that all match unambiguously → return: {"matched":"items","ids":["P001","P002"]}
- If the user's wording matches several bills and they didn't say which (same description for different owners, or the same owner and description with different amounts) → return: {"matched":"ambiguous","ids":["P013","P040"]}
- If no match or unclear → return: {"matched":false}

Respond with JSON only, no other text.`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : ""
  const parsed = extractJson(text) as ConfirmationResult | null
  return parsed ?? { matched: false }
}
