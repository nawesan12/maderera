/**
 * A qué se dedica un cliente.
 *
 * **Reemplaza a «tipo de cliente» en las pantallas**, por pedido de la clienta:
 * «en clientes cambiar lista de tipo de clientes por los rubros, porque
 * consumidor final o particular no tendría rubro». Tenía razón —«particular» no
 * es un rubro, es la ausencia de uno— y el dato que sirve para decidir es el
 * otro: cuántos carpinteros compran, cuánto creció el rubro de las
 * constructoras, a qué gremio conviene avisarle de una promoción.
 *
 * **Es una constante y no una tabla.** La lista la dictó la clienta y cambia
 * cada varios años, no cada semana; como filas editables solo lograría que el
 * mismo rubro conviviera escrito de tres formas, que es exactamente el problema
 * que tenía `customers.rubro` siendo texto libre.
 *
 * Los valores son los mismos del enum `rubro_profesional` del portal, así que
 * un profesional aprobado queda con el rubro que él mismo eligió al anotarse y
 * no con uno que alguien le puso después.
 */

export const RUBROS_CLIENTE = [
  { valor: "particular", etiqueta: "Particular", esProfesional: false },
  { valor: "arquitecto", etiqueta: "Arquitectura", esProfesional: true },
  { valor: "carpintero", etiqueta: "Carpintería", esProfesional: true },
  // De la clienta. Es quien trabaja con cemento —corralón, contrapisos,
  // platea— y compra madera para encofrado y techos.
  { valor: "cementista", etiqueta: "Cementista", esProfesional: true },
  { valor: "constructora", etiqueta: "Constructora", esProfesional: true },
  { valor: "woodframer", etiqueta: "Wood frame", esProfesional: true },
  // La línea propia de molduras: son los clientes que compran Moldava para
  // revender, y la clienta los sigue como rubro aparte.
  { valor: "moldava", etiqueta: "Moldava", esProfesional: true },
  { valor: "disenador", etiqueta: "Diseño de interiores", esProfesional: true },
  { valor: "instalador", etiqueta: "Instalación y colocación", esProfesional: true },
  { valor: "otro", etiqueta: "Otro", esProfesional: true },
] as const;

export type RubroCliente = (typeof RUBROS_CLIENTE)[number]["valor"];

/** Cómo se muestra un rubro. Lo que no está en la lista se muestra tal cual. */
export function etiquetaDeRubro(valor: string | null | undefined): string {
  if (!valor) return "Sin rubro";
  return (
    RUBROS_CLIENTE.find((r) => r.valor === valor)?.etiqueta ?? valor
  );
}

/**
 * Normaliza lo que haya quedado escrito a mano.
 *
 * `customers.rubro` fue texto libre durante toda la primera etapa y trae cosas
 * como «Carpintero», «carpinteria» o «CARPINTERO». Esto las lleva al valor del
 * catálogo cuando se puede reconocer, y deja pasar lo que no —que se sigue
 * mostrando tal cual, en vez de perderse—.
 */
export function normalizarRubro(valor: string | null | undefined): string | null {
  if (!valor) return null;

  const limpio = valor
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (!limpio) return null;

  const exacto = RUBROS_CLIENTE.find((r) => r.valor === limpio);
  if (exacto) return exacto.valor as string;

  /*
   * Por el principio de la palabra: «carpinteria» y «carpintero» son el mismo
   * rubro escrito por dos personas distintas.
   *
   * Va como lista de pares y no como objeto porque una de las raíces es
   * `constructor`, que en un objeto de JavaScript no es una clave cualquiera.
   */
  const raices: [string, RubroCliente][] = [
    ["arquitect", "arquitecto"],
    ["carpinter", "carpintero"],
    ["cement", "cementista"],
    ["constructor", "constructora"],
    ["construccion", "constructora"],
    ["wood", "woodframer"],
    ["frame", "woodframer"],
    ["moldava", "moldava"],
    ["disen", "disenador"],
    ["instal", "instalador"],
    ["coloca", "instalador"],
    ["particular", "particular"],
    ["consumidor", "particular"],
  ];

  for (const [raiz, rubro] of raices) {
    if (limpio.startsWith(raiz)) return rubro;
  }

  return valor.trim();
}
