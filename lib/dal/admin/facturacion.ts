import "server-only";

import { resolverPeriodo, type Periodo } from "@/lib/periodos";
import { api, apiInterna, datos } from "@/lib/api/servidor";
import type { components } from "@/lib/api/tipos/facturacion";
import type { TipoComprobante } from "@/lib/fiscal/comprobantes";

/**
 * Lectura de comprobantes. La sirve la API de Go (backend/internal/facturacion):
 * esto es un envoltorio que pasa las fechas a Date. Solo personal de la
 * empresa, salvo lo que se lee con el secreto interno (las hojas impresas, el
 * PDF y los avisos), donde quien llama ya decidió que se puede ver.
 */

type Esquemas = components["schemas"];

export interface ComprobanteListado extends Omit<Esquemas["ComprobanteListado"], "fechaEmision" | "fechaVencimiento"> {
  tipo: TipoComprobante;
  fechaEmision: Date;
  fechaVencimiento: Date | null;
}

/** Los medios que cuentan como contado, para el filtro de la pantalla. */
export const MEDIOS_DE_CONTADO = [
  "efectivo",
  "transferencia",
  "debito",
  "credito",
  "mercado_pago",
  "cheque",
] as const;

export async function listarComprobantes(
  filtros: {
    estado?: string;
    desde?: Date;
    /** Hasta cuándo, inclusive. */
    hasta?: Date;
    /** Cómo se cobró: `contado`, `cuenta` (sin cobros) o todo. */
    cobro?: "contado" | "cuenta" | "todos";
    /** Número, CUIT o razón social. */
    busqueda?: string;
    tope?: number;
  } = {},
): Promise<ComprobanteListado[]> {
  const filas = datos(
    await (await api()).GET("/api/v1/admin/facturacion/comprobantes", {
      params: {
        query: {
          estado: filtros.estado,
          desde: filtros.desde?.toISOString(),
          hasta: filtros.hasta?.toISOString(),
          cobro: filtros.cobro,
          busqueda: filtros.busqueda?.slice(0, 200),
          tope: filtros.tope,
        },
      },
    }),
  );
  return filas.map((f) => ({
    ...f,
    fechaEmision: new Date(f.fechaEmision),
    fechaVencimiento: f.fechaVencimiento ? new Date(f.fechaVencimiento) : null,
  }));
}

/**
 * El listado de la pantalla de a páginas, con cuántos comprobantes cumplen el
 * filtro y lo que suman (las notas de crédito restan; anuladas, rechazadas y
 * borradores no cuentan), todo calculado en Go sobre el filtro entero.
 */
export async function listarComprobantesPagina(
  filtros: {
    estado?: string;
    desde?: Date;
    hasta?: Date;
    cobro?: "contado" | "cuenta" | "todos";
    busqueda?: string;
  },
  pagina = 1,
  porPagina = 50,
) {
  const r = datos(
    await (await api()).GET("/api/v1/admin/facturacion/comprobantes/pagina", {
      params: {
        query: {
          estado: filtros.estado,
          desde: filtros.desde?.toISOString(),
          hasta: filtros.hasta?.toISOString(),
          cobro: filtros.cobro,
          busqueda: filtros.busqueda?.slice(0, 200),
          limite: porPagina,
          desplazamiento: (pagina - 1) * porPagina,
        },
      },
    }),
  );
  return {
    total: r.total,
    suma: r.suma,
    filas: r.filas.map(
      (f): ComprobanteListado => ({
        ...f,
        tipo: f.tipo as TipoComprobante,
        fechaEmision: new Date(f.fechaEmision),
        fechaVencimiento: f.fechaVencimiento ? new Date(f.fechaVencimiento) : null,
      }),
    ),
  };
}

type Crudo = Esquemas["ComprobanteCompleto"];
type CobroCrudo = Crudo["cobros"][number];

export interface ComprobanteCompleto
  extends Omit<Crudo, "fechaEmision" | "fechaVencimiento" | "caeVencimiento" | "cobros" | "fechaEmisionOriginal"> {
  tipo: TipoComprobante;
  fechaEmision: Date;
  /** La fecha con que se emitió, si al reintentar salió con la del día. */
  fechaEmisionOriginal: Date | null;
  fechaVencimiento: Date | null;
  caeVencimiento: Date | null;
  cobros: (Omit<CobroCrudo, "fecha" | "createdAt"> & { fecha: Date; createdAt: Date })[];
}

function conFechas(c: Crudo): ComprobanteCompleto {
  return {
    ...c,
    fechaEmision: new Date(c.fechaEmision),
    fechaEmisionOriginal: c.fechaEmisionOriginal ? new Date(c.fechaEmisionOriginal) : null,
    fechaVencimiento: c.fechaVencimiento ? new Date(c.fechaVencimiento) : null,
    caeVencimiento: c.caeVencimiento ? new Date(c.caeVencimiento) : null,
    cobros: c.cobros.map((p) => ({ ...p, fecha: new Date(p.fecha), createdAt: new Date(p.createdAt) })),
  };
}

/** Comprobante completo, con líneas, cobros y tributos (el personal). */
export async function obtenerComprobante(id: string): Promise<ComprobanteCompleto | null> {
  const r = await (await api()).GET("/api/v1/comprobantes/{id}", { params: { path: { id } } });
  if (r.response.status === 404 || r.response.status === 400) return null;
  return conFechas(datos(r));
}

export interface FilaDelPadron {
  cuit: string;
  cliente: string | null;
  alicuota: number;
  desde: string;
  hasta: string;
}

/** El padrón de ARBA de los clientes, vigente hoy o después. */
export async function padronIibb(): Promise<FilaDelPadron[]> {
  return datos(await (await api()).GET("/api/v1/admin/facturacion/padron-iibb"));
}

export type DatosDeDevolucion = Esquemas["DatosDeDevolucion"];

/**
 * Lo que se puede devolver de la factura de una venta: los renglones con lo
 * que queda, el tope por caja y por cuenta, y las sucursales. null si la
 * factura no es de una venta (lleva nota de crédito común).
 */
export async function datosDeDevolucion(id: string): Promise<DatosDeDevolucion | null> {
  const r = await (await api()).GET("/api/v1/admin/facturacion/comprobantes/{id}/devolucion", { params: { path: { id } } });
  if (r.response.status === 404 || r.response.status === 400) return null;
  return datos(r);
}

/**
 * El comprobante leído con el secreto interno, para los avisos y WhatsApp:
 * **quien llama ya decidió que se puede ver**.
 */
export async function comprobanteInterno(id: string): Promise<ComprobanteCompleto | null> {
  const r = await apiInterna.GET("/api/v1/comprobantes/{id}", { params: { path: { id } } });
  if (r.response.status === 404 || r.response.status === 400) return null;
  return conFechas(datos(r));
}

/**
 * Comprobante propio del cliente que tiene la sesión abierta. Go mira de quién
 * es con la cookie (a uno ajeno le contesta 404), así que `customerId` queda
 * como doble control.
 */
export async function comprobanteDelCliente(id: string, customerId: string) {
  const comprobante = await obtenerComprobante(id);
  if (!comprobante || comprobante.customerId !== customerId) return null;
  return comprobante;
}

/**
 * La serie de un comprobante sin CAE: cuántos anteriores arrastra el
 * reintento, quiénes bajan un número si se lo da de baja, la deuda que se va
 * con él y por qué no se puede (sin preguntarle a ARCA: eso lo hace la baja).
 */
export async function serieDelComprobante(id: string) {
  const r = await (await api()).GET("/api/v1/admin/facturacion/comprobantes/{id}/serie", {
    params: { path: { id } },
  });
  if (r.response.status === 404 || r.response.status === 403) return null;
  return datos(r);
}

export type DadoDeBaja = Omit<Esquemas["DadoDeBaja"], "fechaEmision" | "createdAt" | "tipo"> & {
  tipo: TipoComprobante;
  fechaEmision: Date;
  createdAt: Date;
};

/** Los comprobantes dados de baja, el más nuevo primero. */
export async function dadosDeBaja(): Promise<DadoDeBaja[]> {
  const filas = datos(await (await api()).GET("/api/v1/admin/facturacion/dados-de-baja"));
  return filas.map((f) => ({
    ...f,
    tipo: f.tipo as TipoComprobante,
    fechaEmision: new Date(f.fechaEmision),
    createdAt: new Date(f.createdAt),
  }));
}

/** Números del período, para la cabecera de la pantalla. */
export async function resumenFacturacion(periodo?: Periodo) {
  const rango = periodo ?? resolverPeriodo("mes");
  return datos(
    await (await api()).GET("/api/v1/admin/facturacion/resumen", {
      params: { query: { desde: rango.desde?.toISOString(), hasta: rango.hasta?.toISOString() } },
    }),
  );
}

export async function listarPuntosVenta() {
  return datos(await (await api()).GET("/api/v1/admin/facturacion/puntos-de-venta"));
}

/**
 * Estado de la conexión con ARCA, para la sección tributaria. Trae también si
 * el certificado y la clave están cargados (los pasos de /admin/arca).
 */
export async function estadoArca() {
  return datos(await (await api()).GET("/api/v1/admin/facturacion/arca"));
}

export type EmisorFiscal = Omit<Esquemas["EmisorFiscal"], "inicioActividades" | "updatedAt"> & {
  inicioActividades: Date | null;
  updatedAt: Date;
};

export function emisorConFechas(e: Esquemas["EmisorFiscal"]): EmisorFiscal {
  return {
    ...e,
    inicioActividades: e.inicioActividades ? new Date(e.inicioActividades) : null,
    updatedAt: new Date(e.updatedAt),
  };
}

export async function configuracionFiscalActual(): Promise<EmisorFiscal> {
  return emisorConFechas(datos(await (await api()).GET("/api/v1/fiscal/emisor")));
}

export type RenglonLibroVentas = Omit<Esquemas["RenglonLibroVentas"], "fechaEmision"> & {
  tipo: TipoComprobante;
  fechaEmision: Date;
};

/**
 * Libro IVA ventas de un mes («aaaa-mm»; sin período, el mes en curso). Go lo
 * corta en hora argentina: una factura de las 22 del último día es de ese mes.
 * Las notas de crédito vienen en negativo.
 */
export async function libroIvaVentas(periodo?: string | null) {
  const libro = datos(
    await (await api()).GET("/api/v1/admin/facturacion/libro-iva", {
      params: { query: periodo ? { periodo } : {} },
    }),
  );
  const filas: RenglonLibroVentas[] = libro.filas.map((f) => ({ ...f, fechaEmision: new Date(f.fechaEmision) }));
  return { filas, totales: libro.totales, clave: libro.clave };
}

/** Pedido listo para facturar, con sus ítems y la condición fiscal del cliente. */
export async function pedidoParaFacturar(orderId: string) {
  const r = await (await api()).GET("/api/v1/admin/facturacion/pedidos/{id}", { params: { path: { id: orderId } } });
  if (r.response.status === 404 || r.response.status === 400) return null;
  return datos(r);
}
