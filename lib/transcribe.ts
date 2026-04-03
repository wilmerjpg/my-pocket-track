import OpenAI from 'openai'

const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function transcribeAudio(buffer: Buffer): Promise<string> {
  const file = new File([new Uint8Array(buffer)], 'voice.ogg', { type: 'audio/ogg' })
  const response = await getOpenAI().audio.transcriptions.create({
    model: 'gpt-4o-mini-transcribe',
    file,
    language: 'es',
  })
  return response.text
}
