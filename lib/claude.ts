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
