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
  /*
   * Los cortes los ve todo el personal, **incluido el aserradero**, que es el
   * único rol que no tiene el panel detrás: la ficha de un trabajo y el formato
   * para la máquina son suyos y se ajustan parados frente a la seccionadora.
   *
   * Hay que declararlo y no dejarlo heredar de `/admin`, que excluye al
   * aserradero. Adentro de esta carpeta manda la clave más larga, y por eso
   * `/admin/cortes/tarifas` sigue siendo solo del admin: el precio por pasada
   * fija cuánto entra por caja, y eso no es regular la máquina.
   */
  "/admin/cortes": ["admin", "vendedor", "deposito", "aserradero"],
  "/mostrador": ["admin", "vendedor"],
  /*
   * Las otras dos pantallas de puesto fijo. Como el mostrador, viven **fuera
   * de `/admin`** para no arrastrar el menú lateral, y justamente por eso el
   * layout del panel no las cubre: hay que declararlas igual, porque esta lista
   * es la fuente única y una ruta que no está acá queda librada a lo que decida
   * su propia página.
   *
   * `/atencion` es la misma bandeja que `/admin/whatsapp` a pantalla completa,
   * así que le corresponde el mismo par. Se comprobó que no era así: con un
   * usuario de depósito, `/admin/whatsapp` rebotaba y `/atencion` abría, con
   * las conversaciones de los clientes y su saldo al costado.
   */
  "/atencion": ["admin", "vendedor"],
  "/taller": ["admin", "vendedor", "deposito", "aserradero"],
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
  /*
   * Las de compras van **una por una y no solo el prefijo**.
   *
   * `puedeEntrar` toma la clave más larga que sea prefijo, así que
   * `/admin/compras` alcanzaba para cerrar las páginas. Pero el menú filtra con
   * `quienEntra`, que busca la ruta **exacta**: sin estas líneas devolvía `null`
   * y le mostraba Pagos, Gastos y Facturas de compra a todo el personal, que al
   * entrar rebotaba. Es justamente lo que advierte el comentario de arriba.
   */
  "/admin/compras": ["admin"],
  "/admin/compras/ordenes": ["admin"],
  "/admin/compras/facturas": ["admin"],
  "/admin/compras/pagos": ["admin"],
  "/admin/compras/gastos": ["admin"],
  "/admin/cierre": ["admin"],
  // Los reportes son los números del negocio: quién compra, cuánto se vende y
  // a qué margen. Es la misma sensibilidad que precios y cobros.
  "/admin/reportes": ["admin"],
  "/admin/sucursales": ["admin"],
  // Una tarifa de envío es un precio: no la cambia quien atiende el mostrador.
  "/admin/envios": ["admin"],
  // Las dos reglas que fijan cuánto entra por caja: tarifa de corte y
  // descuento por forma de pago. Son precios, no operación.
  "/admin/cortes/tarifas": ["admin"],
  "/admin/precios/formas-de-pago": ["admin"],
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
