import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { firmaValida } from "@/lib/whatsapp/webhook";
import { encolar, procesarCola } from "@/lib/cola";

/**
 * Webhook de la WhatsApp Cloud API.
 *
 * Es por donde entran los mensajes de los clientes, los estados de lo que
 * mandamos y los cambios de las plantillas. Tiene que contestar 200 rápido:
 * Meta reintenta si tardás —durante hasta siete días—, y el reintento llega
 * como mensaje repetido. Por eso el payload se guarda en la cola
 * (`lib/cola`) y el trabajo real —bajar adjuntos, escribir en la base, avisar
 * al panel— corre en `after()`, ya con la respuesta enviada. Si el proceso se
 * reinicia en ese segundo, el trabajo sigue en la cola y lo levanta la tarea
 * de cada minuto.
 *
 * Alta en Meta (ver `docs/WHATSAPP.md`): URL
 * `https://mjbj.com.ar/api/whatsapp/webhook`, verify token igual a
 * `WHATSAPP_WEBHOOK_SECRET`, campos `messages` y
 * `message_template_status_update` (y los de coexistencia si se usa).
 */

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Verificación de Meta al dar de alta la URL. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const secreto = process.env.WHATSAPP_WEBHOOK_SECRET;

  if (
    secreto &&
    params.get("hub.mode") === "subscribe" &&
    iguales(params.get("hub.verify_token") ?? "", secreto)
  ) {
    return new NextResponse(params.get("hub.challenge") ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.json({ error: "Verificación inválida." }, { status: 403 });
}

/** El tope de Meta para un payload es 3 MB; más que eso no viene de Meta. */
const MAXIMO_BYTES = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
  // El cuerpo se lee crudo, en bytes: la firma se calcula sobre el texto
  // exacto, y parsear y volver a serializar lo cambia.
  const crudo = new Uint8Array(await request.arrayBuffer());
  if (crudo.byteLength > MAXIMO_BYTES) {
    return NextResponse.json({ error: "Demasiado grande." }, { status: 413 });
  }

  if (!firmaValida(crudo, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Firma inválida." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(crudo));
  } catch {
    // 200 igual: que Meta no reintente algo que nunca va a poder parsear.
    return NextResponse.json({ ok: true });
  }

  // A la cola antes de contestar: un reinicio en este segundo ya no pierde el
  // mensaje. Los errores y reintentos los maneja la cola.
  const id = await encolar("whatsapp.payload", { payload });
  after(() => procesarCola({ soloId: id }));

  return NextResponse.json({ ok: true });
}
