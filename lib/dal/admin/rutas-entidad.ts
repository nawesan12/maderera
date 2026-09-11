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
