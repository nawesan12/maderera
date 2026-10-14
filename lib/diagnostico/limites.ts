/**
 * Los números de límite repetidos en un HTML armado por React.
 *
 * React numera cada `<Suspense>` que manda aparte: el lugar queda marcado con
 * `<template id="B:5">` y el contenido llega después en `<div hidden
 * id="S:5">`, que un script mueve a su lugar. Si el mismo número aparece dos
 * veces, el script mueve el contenido equivocado o deja uno sin mover, y la
 * hidratación falla con el error #419 («The server could not finish this
 * Suspense boundary»): React descarta lo del servidor y lo vuelve a armar en el
 * navegador.
 *
 * Pasó en el catálogo y en el stock el 14/10/2026. La causa es un defecto de
 * React con Cache Components, explicado en `EnlaceDeSeccion`
 * (`components/navbar.tsx`): un límite que se resuelve en el build y pesa más
 * de 500 bytes toma un número que después vuelve a usar lo que se arma en cada
 * visita. No se ve en desarrollo —ahí no hay parte armada de antemano— y no
 * deja nada en el registro del servidor; solo se ve en la consola del
 * navegador, con un build de producción. Por eso esto existe aparte: para
 * revisar el HTML sin abrir un navegador (`scripts/revisar-limites.ts`).
 */
export function limitesRepetidos(html: string): string[] {
  const vistos = new Map<string, number>();
  const contar = (id: string) => vistos.set(id, (vistos.get(id) ?? 0) + 1);

  // El lugar de cada límite pendiente y cada contenido que llega aparte. Los
  // `P:` son los huecos de lo que se arma por pedido: también se numeran con
  // la misma cuenta, y uno repetido rompe igual.
  for (const m of html.matchAll(/<template id="([BP]:\d+)"/g)) contar(m[1]!);
  for (const m of html.matchAll(/<div hidden id="(S:\d+)"/g)) contar(m[1]!);

  return [...vistos].filter(([, veces]) => veces > 1).map(([id]) => id);
}
