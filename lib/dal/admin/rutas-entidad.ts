/**
 * A dónde lleva cada cosa que anota la bitácora.
 *
 * La bitácora y la campana de actividad decían "Marcó PED-0231 como cobrado" y
 * dejaban ahí: el nombre de la entidad era un chip de texto y no se podía
 * abrir. Es la clase de pantalla que se mira cuando algo no cuadra, o sea
 * cuando uno **más** quiere ir a ver la cosa en cuestión.
 *
 * **El id de la bitácora no siempre es un uuid.** Algunas acciones anotan el
 * número visible —"CRT-459"— porque es lo que sirve para leer el renglón. Para
 * esas, el enlace va al listado con la búsqueda puesta, que llega al mismo
 * lugar y no inventa una ruta que daría 404.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Entidades con ficha propia: la ruta se arma con el id. */
const FICHAS: Record<string, string> = {
  cliente: "/admin/clientes",
  pedido: "/admin/pedidos",
  presupuesto: "/admin/presupuestos",
  corte: "/admin/cortes",
  producto: "/admin/productos",
  proveedor: "/admin/proveedores",
  factura: "/admin/facturacion",
  orden_compra: "/admin/compras/ordenes",
  recepcion: "/admin/recepciones",
};

/** Entidades que viven dentro de un listado: se abre el listado. */
const LISTADOS: Record<string, string> = {
  banner: "/admin/contenido/banners",
  promo_bancaria: "/admin/contenido/promociones",
  caja: "/admin/caja",
  cheque: "/admin/cheques",
  condicion_proveedor: "/admin/proveedores",
  configuracion: "/admin/arca",
  descuento_pago: "/admin/precios/formas-de-pago",
  factura_compra: "/admin/compras/facturas",
  gasto: "/admin/compras/gastos",
  lista_precios: "/admin/precios/listas",
  migracion: "/admin/migracion",
  pago: "/admin/pagos",
  pago_proveedor: "/admin/compras/pagos",
  precio: "/admin/precios",
  profesional: "/admin/profesionales",
  remito: "/admin/pedidos",
  retencion_sufrida: "/admin/arca/retenciones",
  stock: "/admin/stock",
  tarifa_corte: "/admin/cortes/tarifas",
  vendedor: "/admin/clientes/vendedores",
  zona_envio: "/admin/envios",
};

export function rutaDeEntidad(
  entidad: string,
  entidadId?: string | null,
): string | null {
  const ficha = FICHAS[entidad];
  if (ficha) {
    if (entidadId && UUID.test(entidadId)) return `${ficha}/${entidadId}`;
    // Un número visible: el listado lo encuentra buscándolo.
    if (entidadId) return `${ficha}?buscar=${encodeURIComponent(entidadId)}`;
    return ficha;
  }

  return LISTADOS[entidad] ?? null;
}

/**
 * Cómo se llama cada cosa en castellano.
 *
 * La bitácora armaba su desplegable "Sobre qué" con los nombres que la tabla
 * guarda, así que quien la usaba elegía entre `orden_compra`,
 * `condicion_proveedor` y `retencion_sufrida`, y el chip de cada renglón los
 * repetía igual. Son nombres de programador filtrados a la pantalla de alguien
 * que quiere saber quién tocó un precio.
 *
 * Vive acá y no en la página porque las claves son exactamente las de arriba:
 * si aparece una entidad nueva, falta su ruta **y** su nombre, y conviene que
 * las dos se noten en el mismo archivo.
 */
const ETIQUETAS: Record<string, string> = {
  banner: "Cartel del sitio",
  caja: "Caja",
  cheque: "Cheque",
  cliente: "Cliente",
  condicion_proveedor: "Condición con el proveedor",
  configuracion: "Configuración",
  corte: "Corte",
  descuento_pago: "Descuento por forma de pago",
  factura: "Factura emitida",
  factura_compra: "Factura de compra",
  gasto: "Gasto",
  lista_precios: "Lista de precios",
  migracion: "Migración de datos",
  orden_compra: "Orden de compra",
  pago: "Cobro",
  pago_proveedor: "Pago a proveedor",
  pedido: "Pedido",
  precio: "Precio",
  producto: "Producto",
  profesional: "Profesional",
  promo_bancaria: "Promoción bancaria",
  presupuesto: "Presupuesto",
  proveedor: "Proveedor",
  recepcion: "Recepción de mercadería",
  remito: "Remito",
  retencion_sufrida: "Retención que nos hicieron",
  stock: "Stock",
  tarifa_corte: "Tarifa de corte",
  vendedor: "Vendedor",
  zona_envio: "Zona de envío",
};

/**
 * El nombre de una entidad para mostrar.
 *
 * Si aparece una que no está en la tabla, se devuelve legible —guiones bajos
 * por espacios y la primera en mayúscula— en vez del nombre crudo: es mejor
 * "Nota de crédito" que `nota_credito`, y peor que ninguna de las dos es que la
 * pantalla se rompa porque alguien agregó una entidad y no pasó por acá.
 */
/**
 * Todas las entidades que el panel sabe nombrar y a dónde llevar.
 *
 * Se arma de las tres tablas de este archivo para que un test pueda exigir que
 * vayan juntas: una entidad con ruta y sin nombre sale a la pantalla escrita
 * como la guarda la base, que es exactamente el defecto que esto vino a tapar.
 */
export const ENTIDADES_CONOCIDAS: readonly string[] = [
  ...new Set([
    ...Object.keys(FICHAS),
    ...Object.keys(LISTADOS),
    ...Object.keys(ETIQUETAS),
  ]),
].sort();

export function etiquetaDeEntidad(entidad: string): string {
  if (ETIQUETAS[entidad]) return ETIQUETAS[entidad];
  const suelto = entidad.replace(/_/g, " ");
  return suelto.charAt(0).toUpperCase() + suelto.slice(1);
}
