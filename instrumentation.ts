import type { Instrumentation } from "next";

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

/**
 * Cada error que Next atrapa al armar una página, con la ruta.
 *
 * Next ya los escribe en el registro, pero sin decir de qué página venían: con
 * un digest y una pila minificada no se sabe por dónde empezar. Este renglón
 * agrega la ruta pedida, el archivo y si pasó al armar de antemano o por
 * pedido. Ver `lib/diagnostico/registro.ts`.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  pedido,
  contexto,
) => {
  const { lineaDelServidor } = await import("./lib/diagnostico/registro");
  console.error(lineaDelServidor(error, pedido, contexto));
};
