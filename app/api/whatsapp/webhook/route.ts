import { after, NextResponse, type NextRequest } from "next/server";
import {
  firmaValida,
  procesarPayload,
  type PayloadWebhook,
} from "@/lib/whatsapp/webhook";

/**
 * Webhook de la WhatsApp Cloud API.
 *
 * Es por donde entran los mensajes de los clientes y los avisos de entrega de
 * lo que mandamos. Tiene que contestar 200 rápido: Meta reintenta si tardás, y
 * el reintento llega como mensaje repetido. Por eso el trabajo real -descargar
 * adjuntos, escribir en la base- corre en `after()`, ya con la respuesta
 * enviada.
 *
 * Alta en Meta: URL `https://<dominio>/api/whatsapp/webhook`, verify token
 * igual a `WHATSAPP_WEBHOOK_SECRET`, campo suscrito `messages`.
 */
export const runtime = "nodejs";

/** Verificación inicial de Meta al dar de alta la URL. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const secreto = process.env.WHATSAPP_WEBHOOK_SECRET;

  if (
    secreto &&
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === secreto
  ) {
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
  }

  return NextResponse.json({ error: "Verificación inválida." }, { status: 403 });
}

export async function POST(request: NextRequest) {
  // El cuerpo se lee crudo: la firma se calcula sobre el texto exacto, y
  // parsear y volver a serializar cambia bytes y la invalida.
  const cuerpoCrudo = await request.text();

  if (!firmaValida(cuerpoCrudo, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Firma inválida." }, { status: 401 });
  }

  let payload: PayloadWebhook;

  try {
    payload = JSON.parse(cuerpoCrudo) as PayloadWebhook;
  } catch {
    // 200 igual: que Meta no reintente algo que nunca va a poder parsear.
    return NextResponse.json({ ok: true });
  }

  after(async () => {
    try {
      await procesarPayload(payload);
    } catch (error) {
      console.error(
        JSON.stringify({
          scope: "whatsapp.webhook",
          evento: "error_procesando",
          detalle: error instanceof Error ? error.message : "desconocido",
        }),
      );
    }
  });

  return NextResponse.json({ ok: true });
}
