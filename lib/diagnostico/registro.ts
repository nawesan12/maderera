/**
 * Lo que se anota cuando algo falla al armar una página, con la ruta.
 *
 * El React #419 se vio dos veces en el sitio y no se pudo reproducir: en la
 * consola del navegador decía el número y nada más, y en el registro del
 * servidor no había nada. Sin la ruta no había por dónde empezar. Ahora quedan
 * dos renglones, uno de cada lado:
 *
 * - **Del servidor** (`onRequestError`, en `instrumentation.ts`): cada error
 *   que Next atrapa al armar una página, con la ruta pedida, el archivo de la
 *   ruta y si fue en el armado de antemano o por pedido.
 * - **Del navegador** (`instrumentation-client.ts` → `/api/diagnostico`): los
 *   errores de hidratación, que son los que el servidor no ve nunca. El #419
 *   del 14/10/2026 era de esos: el HTML salía bien del servidor y se rompía al
 *   ensamblarse en el navegador.
 *
 * Los dos salen por `console.error` como JSON de una línea, igual que el resto
 * de los avisos del sistema: `docker compose logs app | grep diagnostico`.
 */

/** Los errores de React que vale la pena mandar: hidratación y límites. */
const DE_HIDRATACION =
  /(react\.dev\/errors\/|React error #)(418|419|421|422|423|425)(?!\d)|Hydration|hydrat|could not finish this Suspense boundary|did not finish this Suspense boundary/i;

export function esErrorDeHidratacion(mensaje: string): boolean {
  return DE_HIDRATACION.test(mensaje);
}

/** Lo que manda el navegador. Todo opcional y recortado: viene de afuera. */
export interface ReporteDelNavegador {
  ruta: string;
  mensaje: string;
  /** El primer tramo de la pila: dice qué componente, aunque esté minificado. */
  pila?: string;
  build?: string;
}

const LARGO_MAXIMO = 500;

function texto(valor: unknown, largo = LARGO_MAXIMO): string | undefined {
  if (typeof valor !== "string") return undefined;
  const limpio = valor.replace(/[\r\n]+/g, " ").trim();
  return limpio ? limpio.slice(0, largo) : undefined;
}

/**
 * Valida lo que llegó a `/api/diagnostico`. Devuelve null si no es un reporte:
 * el endpoint es público y no tiene por qué anotar cualquier cosa que le
 * manden. Solo pasan errores de hidratación, con una ruta del sitio.
 */
export function leerReporte(cuerpo: unknown): ReporteDelNavegador | null {
  if (!cuerpo || typeof cuerpo !== "object") return null;
  const datos = cuerpo as Record<string, unknown>;

  const ruta = texto(datos.ruta, 300);
  const mensaje = texto(datos.mensaje);
  if (!ruta || !ruta.startsWith("/") || !mensaje) return null;
  if (!esErrorDeHidratacion(mensaje)) return null;

  return {
    ruta,
    mensaje,
    pila: texto(datos.pila, 1000),
    build: texto(datos.build, 40),
  };
}

/** El renglón del registro, para un error que vio el navegador. */
export function lineaDelNavegador(reporte: ReporteDelNavegador): string {
  return JSON.stringify({ scope: "diagnostico.navegador", ...reporte });
}

/** El renglón del registro, para un error que atrapó el servidor. */
export function lineaDelServidor(
  error: unknown,
  pedido: { path: string; method: string },
  contexto: { routerKind: string; routePath: string; routeType: string; renderSource?: string },
): string {
  const mensaje = error instanceof Error ? error.message : String(error);
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest: unknown }).digest)
      : undefined;

  return JSON.stringify({
    scope: "diagnostico.servidor",
    ruta: pedido.path,
    metodo: pedido.method,
    archivo: contexto.routePath,
    tipo: contexto.routeType,
    armado: contexto.renderSource,
    digest,
    mensaje: texto(mensaje, 1000),
  });
}
