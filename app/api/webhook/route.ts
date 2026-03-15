import { NextRequest, NextResponse } from "next/server";

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

// Meta calls this to verify your webhook
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// Meta sends incoming WhatsApp messages here
export async function POST(req: NextRequest) {
  const body = await req.json();
  console.log("Incoming message:", JSON.stringify(body, null, 2));
  return NextResponse.json({ status: "ok" });
}
