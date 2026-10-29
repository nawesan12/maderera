/**
 * El lado TypeScript del benchmark de la tanda 9: la bandeja y el webhook de
 * WhatsApp **como eran antes de la mudanza** (git 9a17128, copiados con
 * copiar-ts.mjs), servidos por node:http, sin Next. Ver README.md.
 *
 *   DATABASE_URL=… BENCH_USUARIO=<id del admin> WHATSAPP_APP_SECRET=secreto-de-prueba WHATSAPP_PROVIDER=demo \
 *     npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda9/ts-servidor.ts   # :8389
 */
import { createServer } from "node:http";

async function main() {
  const dal = await import("./ts/dal-whatsapp");
  const webhook = await import("./ts/whatsapp/webhook");
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");

  createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    try {
      switch (u.pathname) {
        case "/salud":
          return res.end("ok");
        case "/bandeja": {
          // Lo que hacía app/admin/whatsapp/vista.tsx: seis lecturas a la vez y la conversación elegida.
          const [conversaciones, estado, plantillas, contadores, personal, gasto] = await Promise.all([
            dal.listarConversaciones("todas"),
            dal.estadoWhatsapp(),
            dal.listarPlantillas(),
            dal.contarBandeja(),
            dal.personalDeLaBandeja(),
            dal.gastoParaLaBandeja(),
          ]);
          const detalle = conversaciones[0] ? await dal.obtenerConversacion(conversaciones[0].id) : null;
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ conversaciones, estado, plantillas, contadores, personal, gasto, detalle }));
        }
        case "/api/whatsapp/webhook": {
          // La ruta de antes: firma sobre los bytes crudos, a la cola y 200
          // (sin el after() que lo procesaba: el drenaje se mide aparte).
          const partes: Buffer[] = [];
          for await (const p of req) partes.push(p as Buffer);
          const crudo = new Uint8Array(Buffer.concat(partes));
          if (!webhook.firmaValida(crudo, (req.headers["x-hub-signature-256"] as string) ?? null)) {
            res.writeHead(401);
            return res.end('{"error":"Firma inválida."}');
          }
          const payload = JSON.parse(new TextDecoder().decode(crudo));
          await db.execute(sql`insert into trabajos (tipo, carga) values ('whatsapp.payload', ${JSON.stringify({ payload })}::jsonb)`);
          res.writeHead(200, { "content-type": "application/json" });
          return res.end('{"ok":true}');
        }
        case "/drenar": {
          // Procesa los whatsapp.payload pendientes con el manejador de antes.
          const inicio = Date.now();
          let hechos = 0;
          for (;;) {
            const { rows } = await db.execute<{ id: string; carga: { payload: unknown } }>(sql`
              update trabajos set estado = 'procesando', intentos = intentos + 1
               where id = (select id from trabajos where tipo = 'whatsapp.payload' and estado = 'pendiente'
                            order by proximo_intento_at limit 1 for update skip locked)
              returning id, carga`);
            if (!rows[0]) break;
            await webhook.procesarPayload(rows[0].carga.payload);
            await db.execute(sql`update trabajos set estado = 'hecho', terminado_at = now() where id = ${rows[0].id}`);
            hechos++;
          }
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ hechos, ms: Date.now() - inicio }));
        }
      }
      res.writeHead(404);
      res.end();
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  }).listen(8389, () => console.log("ts-servidor en :8389"));
}
main();
