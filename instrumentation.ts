/**
 * Lo que se mira una sola vez, al arrancar el servidor.
 *
 * Next llama a `register` antes de atender el primer pedido. Acá se usa para
 * no arrancar cuando falta algo sin lo cual el sitio parece andar pero cobra
 * mal (ver `lib/entorno.ts`). En el servidor propio eso se ve enseguida —el
 * contenedor no levanta y `docker compose logs app` dice qué falta— en lugar
 * de descubrirse con el primer pago que vuelve a `localhost`.
 *
 * Dos casos se saltean:
 *
 * - **El build.** Next carga este archivo también mientras prerenderiza, y ahí
 *   no tiene sentido exigir lo que recién se usa al atender pedidos.
 * - **El runtime de Edge.** El chequeo termina el proceso de Node; por eso
 *   vive en un módulo aparte que solo se importa acá adentro.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { verificarArranque } = await import("./lib/arranque");
  verificarArranque();
}
