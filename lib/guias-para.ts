import type { RolStaff } from "@/lib/roles";

/**
 * Para quién es cada guía de `docs/GUIAS/` (la cabecera `para:`), sin leer
 * el disco: lo usa el Proxy para contestar un 404 de verdad a la guía que no
 * existe o es de otro puesto. La página decide adentro de un `<Suspense>`,
 * con la respuesta ya empezada en 200 (mes 23; ver «Status codes» en
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md).
 *
 * `null` es todo el personal. tests/guias.test.ts revisa que coincida con los
 * archivos: una guía nueva sin anotar acá daría 404.
 */
export const PARA_DE_CADA_GUIA: Record<string, readonly RolStaff[] | null> = {
  "primeros-pasos": null,
  vender: ["admin", "vendedor"],
  clientes: ["admin", "vendedor"],
  stock: ["admin", "vendedor", "deposito"],
  precios: ["admin"],
  facturacion: ["admin"],
  cobros: ["admin"],
  productos: ["admin", "vendedor"],
  "cortes-y-whatsapp": ["admin", "vendedor", "deposito", "aserradero"],
  sitio: ["admin"],
  "si-algo-sale-mal": null,
  compras: ["admin"],
  "cierre-del-mes": ["admin"],
  cobranza: ["admin", "vendedor"],
};

/** Si ese puesto abre esa guía. */
export function guiaVisible(slug: string, rol: RolStaff | null): boolean {
  if (!Object.hasOwn(PARA_DE_CADA_GUIA, slug)) return false;
  const para = PARA_DE_CADA_GUIA[slug];
  return para === null || (rol !== null && para.includes(rol));
}
