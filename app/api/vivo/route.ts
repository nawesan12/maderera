import type { NextRequest } from "next/server";
import { getSession } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { CANALES, PANTALLA_DEL_CANAL, type Canal, type EventoEnVivo } from "@/lib/vivo/canales";
import { escuchaEnVivo, tiempoRealDisponible } from "@/lib/vivo/escucha";

/**
 * Los avisos en vivo del panel, por Server-Sent Events.
 *
 * Una conexión por pestaña (ver `lib/vivo/use-en-vivo.ts`), con todos los
 * canales que el rol puede ver: la bandeja de WhatsApp, la cola del taller,
 * los pedidos web y los precios del mostrador. Reemplaza el «volver a
 * consultar cada diez segundos», que era una consulta por pestaña aunque no
 * hubiera pasado nada.
 *
 * SSE y no WebSocket: los avisos van en un solo sentido, el navegador
 * reconecta solo, y pasa por Caddy sin configuración especial.
 *
 * **204 cuando no hay tiempo real** (Vercel, ver `tiempoRealDisponible`): el
 * `EventSource` lo toma como «no reintentar» y cada pantalla vuelve a su
 * consulta periódica de siempre.
 */
const LATIDO_MS = 25_000;

export async function GET(request: NextRequest) {
  if (!tiempoRealDisponible()) return new Response(null, { status: 204 });

  const sesion = await getSession();
  const rol = sesion?.staffRole;
  if (!rol) return new Response(null, { status: 401 });

  const permitidos = new Set<Canal>(
    CANALES.filter((canal) => puedeEntrar(PANTALLA_DEL_CANAL[canal], rol)),
  );
  if (permitidos.size === 0) return new Response(null, { status: 204 });

  const escucha = escuchaEnVivo();
  try {
    await escucha.asegurar();
  } catch {
    // La base no contesta: mejor que la pantalla siga consultando a que se
    // quede esperando avisos que no van a llegar. El navegador reintenta.
    return new Response(null, { status: 503 });
  }

  const codificar = new TextEncoder();
  let limpiar = () => {};

  const flujo = new ReadableStream<Uint8Array>({
    start(controlador) {
      const enviar = (texto: string) => {
        try {
          controlador.enqueue(codificar.encode(texto));
        } catch {
          limpiar();
        }
      };

      // Cada cuánto reintenta el navegador si se corta.
      enviar(`retry: 5000\n: ${[...permitidos].join(",")}\n\n`);

      const alEvento = (evento: EventoEnVivo) => {
        if (!permitidos.has(evento.canal)) return;
        enviar(`event: ${evento.canal}\ndata: ${JSON.stringify(evento)}\n\n`);
      };
      // Después de una caída de la escucha, «refrescá por las dudas».
      const alReconectar = () => enviar(`event: reconexion\ndata: {}\n\n`);

      // El comentario cada 25 s mantiene viva la conexión a través de Caddy y
      // de cualquier proxy que corte las que parecen quietas.
      const latido = setInterval(() => enviar(`: latido\n\n`), LATIDO_MS);

      escucha.on("evento", alEvento);
      escucha.on("reconexion", alReconectar);

      limpiar = () => {
        clearInterval(latido);
        escucha.off("evento", alEvento);
        escucha.off("reconexion", alReconectar);
        try {
          controlador.close();
        } catch {
          // Ya estaba cerrado.
        }
      };

      request.signal.addEventListener("abort", () => limpiar());
    },
    cancel() {
      limpiar();
    },
  });

  return new Response(flujo, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Que ningún proxy lo junte en un buffer: un aviso que llega a los
      // treinta segundos no es «en vivo».
      "X-Accel-Buffering": "no",
    },
  });
}
