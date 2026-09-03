/**
 * Los roles del panel.
 *
 * Vive fuera de `lib/dal/session.ts` porque eso es `server-only` y el menú
 * lateral es un componente de cliente. Acá no hay nada que consultar ni que
 * proteger: es el tipo y una función pura, y las dos partes necesitan las
 * mismas para no escribir la lista de roles dos veces.
 */
export type RolStaff = "admin" | "vendedor" | "deposito" | "aserradero";

/**
 * A dónde va cada rol cuando entra o cuando lo rebotan de una sección.
 *
 * El aserradero no arranca en el resumen: arranca en su pantalla. Mandarlo al
 * resumen sería mostrarle ventas del mes, que no es lo suyo y con lo que no
 * puede hacer nada.
 */
export function inicioDelRol(rol: RolStaff | null): string {
  return rol === "aserradero" ? "/taller" : "/admin";
}

/**
 * Quién puede entrar a cada sección del panel.
 *
 * **Es una sola fuente y no dos.** Antes esta lista vivía en el menú lateral, y
 * el menú solo esconde: escondía Precios, ARCA, Cobros y Caja de quien no era
 * admin, pero las páginas solo pedían ser personal. Un vendedor tecleando la
 * dirección entraba igual y podía cambiar precios. Se comprobó con un usuario
 * de rol vendedor: de las seis pantallas restringidas, cinco se abrían.
 *
 * Ahora el menú filtra con esto y cada página lo exige con esto. Agregar una
 * sección nueva sin decidir quién la ve la deja abierta a todo el personal, que
 * es la decisión por defecto correcta para una pantalla de consulta y hay que
 * pensarla dos veces para una que toca plata.
 *
 * Vive acá y no en `lib/dal/session.ts` porque ese módulo es `server-only` y el
 * menú es un componente de cliente.
 */
export const ACCESO: Record<string, readonly RolStaff[]> = {
  "/admin": ["admin", "vendedor", "deposito"],
  "/admin/pedidos": ["admin", "vendedor", "deposito"],
  "/admin/whatsapp": ["admin", "vendedor"],
  "/admin/presupuestos": ["admin", "vendedor"],
  "/mostrador": ["admin", "vendedor"],
  "/admin/productos": ["admin", "vendedor"],
  "/admin/stock": ["admin", "vendedor", "deposito"],
  "/admin/precios": ["admin"],
  "/admin/clientes": ["admin", "vendedor"],
  "/admin/profesionales": ["admin", "vendedor"],
  "/admin/documentacion": ["admin", "vendedor"],
  "/admin/contenido": ["admin"],
  "/admin/eventos": ["admin", "vendedor"],
  "/admin/pagos": ["admin"],
  "/admin/facturacion": ["admin"],
  "/admin/arca": ["admin"],
  "/admin/avisos": ["admin"],
  "/admin/caja": ["admin"],
  /*
   * Compras. Lo que se le paga a un proveedor y a qué costo entró cada tabla es
   * tan sensible como los precios de venta: de ahí sale el margen, que es el
   * número que no se muestra en el mostrador.
   */
  "/admin/proveedores": ["admin"],
  "/admin/recepciones": ["admin"],
  // Los reportes son los números del negocio: quién compra, cuánto se vende y
  // a qué margen. Es la misma sensibilidad que precios y cobros.
  "/admin/reportes": ["admin"],
  "/admin/sucursales": ["admin"],
  "/admin/migracion": ["admin"],
  "/admin/bitacora": ["admin"],
};

/** Los roles que pueden entrar a una ruta, o `null` si la ve todo el personal. */
export function quienEntra(ruta: string): readonly RolStaff[] | null {
  return ACCESO[ruta] ?? null;
}

/**
 * Si un rol puede entrar a una dirección, incluidas las de adentro.
 *
 * Toma la clave más larga que sea prefijo: `/admin/pedidos/PED-1` hereda de
 * `/admin/pedidos`. Va por segmento y no por texto para que `/admin/pagos` no
 * termine cubriendo una futura `/admin/pagos-especiales`, que sería otra
 * sección y otra decisión.
 */
export function puedeEntrar(ruta: string, rol: RolStaff | null): boolean {
  if (!rol) return false;

  let mejor: readonly RolStaff[] | null = null;
  let largo = -1;

  for (const [clave, permitidos] of Object.entries(ACCESO)) {
    if (ruta !== clave && !ruta.startsWith(clave + "/")) continue;
    if (clave.length > largo) {
      largo = clave.length;
      mejor = permitidos;
    }
  }

  // Sin regla declarada entra todo el personal: una sección nueva no queda
  // trabada por olvido, pero tampoco abierta sin que se note en esta lista.
  return mejor ? mejor.includes(rol) : true;
}
