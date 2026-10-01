/**
 * En qué clase de despliegue está corriendo la aplicación.
 *
 * Mientras el sitio vivió en Vercel, la plataforma lo decía sola: `VERCEL_ENV`
 * vale `production`, `preview` o `development`, y con eso alcanzaba para saber
 * si una página se podía indexar. En un servidor propio esa variable no existe,
 * y sin ella cualquier copia del sitio —una de prueba, la de la máquina de
 * alguien— se comportaría como producción.
 *
 * `APP_ENV` es la misma idea, pero la escribe quien despliega: `production` en
 * el servidor de la maderera, cualquier otra cosa en una copia de prueba. Si
 * las dos están, gana la de Vercel, que es la que sabe dónde está corriendo.
 *
 * Este módulo no lleva `server-only` a propósito: lo importa `lib/seo.ts`, que
 * se prueba con Vitest, y no lee nada secreto.
 */

/** `production`, `preview`, `staging`… o nada, si nadie lo declaró. */
export function entornoDeDespliegue(): string | undefined {
  const declarado = (process.env.VERCEL_ENV || process.env.APP_ENV)?.trim();
  return declarado ? declarado.toLowerCase() : undefined;
}

/**
 * Lo que tiene que estar antes de atender el primer pedido.
 *
 * Devuelve la lista de problemas en castellano; vacía si está todo. Se usa al
 * arrancar el servidor (ver `instrumentation.ts`) y existe aparte para poder
 * probarla sin levantar nada.
 *
 * **Por qué `APP_URL` es lo único que frena el arranque.** Todo lo demás tiene
 * un modo de demostración o un valor razonable por omisión. La URL pública no:
 * sin ella, el retorno de Mercado Pago y el webhook apuntan a
 * `http://localhost:3000`, los enlaces de los correos también, y el sitemap y
 * las canónicas declaran un dominio que puede no ser el real. Nada de eso falla
 * a la vista: el pago se cobra y el cliente vuelve a una página que no existe.
 * Es preferible que el contenedor no levante y que el despliegue lo diga.
 *
 * En Vercel no se exige: ahí `lib/pagos/config.ts` cae a la URL que da la
 * plataforma.
 */
export function problemasDeArranque(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (env.VERCEL) return [];
  if (env.NODE_ENV !== "production") return [];

  const problemas: string[] = [];
  const url = env.APP_URL?.trim();

  if (!url) {
    problemas.push(
      "Falta APP_URL: es la URL pública del sitio (por ejemplo https://mjbj.ar) y sin ella Mercado Pago, los correos y el sitemap arman enlaces a localhost.",
    );
  } else if (!URL.canParse(url)) {
    problemas.push(`APP_URL no es una URL válida: «${url}».`);
  }

  return problemas;
}

/**
 * Lo que conviene avisar pero no frena el arranque.
 *
 * `SEO_INDEXAR` sin declarar no rompe nada —el sitio se indexa, que en
 * producción es lo correcto—, pero en un servidor propio no hay `VERCEL_ENV`
 * que proteja a una copia de prueba de terminar en Google. Que el registro lo
 * diga al arrancar es la forma de que alguien lo note.
 */
export function avisosDeArranque(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.VERCEL || env.NODE_ENV !== "production") return [];

  const avisos: string[] = [];
  if (!env.APP_ENV) {
    avisos.push(
      "APP_ENV no está declarado: el servidor de la maderera lleva APP_ENV=production y una copia de prueba cualquier otro valor.",
    );
  }
  if (!env.SEO_INDEXAR) {
    avisos.push(
      "SEO_INDEXAR no está declarado: se indexa por omisión. Declararlo explícitamente (si o no) evita sorpresas en una copia de prueba.",
    );
  }
  return avisos;
}
