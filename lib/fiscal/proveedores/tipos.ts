import type { TipoComprobante } from "../comprobantes";

/**
 * Contrato del proveedor fiscal.
 *
 * La UI y las Server Actions importan solo esta interfaz. Hay dos
 * implementaciones: `arca` habla con los webservices de ARCA, e `interno`
 * numera y emite sin pedir autorización.
 *
 * La separación no es decorativa: el certificado digital lo tramita el cliente
 * ante ARCA y hoy no existe. Con el adaptador, la facturación entera se
 * construye, se usa y se prueba mientras tanto; el día que llegue el
 * certificado se cambia una variable de entorno. Lo que **no** se hace es
 * fingir que un comprobante está autorizado: sin CAE queda marcado como sin
 * valor fiscal, en la pantalla y en la impresión.
 */

export type ProveedorFiscalId = "arca" | "interno";
export type AmbienteArca = "homologacion" | "produccion";

/** Un comprobante listo para pedir autorización. */
export interface ComprobanteAAutorizar {
  tipo: TipoComprobante;
  puntoVenta: number;
  numero: number;
  fechaEmision: Date;

  receptorCuit: string | null;
  receptorCondicionIva:
    | "responsable_inscripto"
    | "monotributista"
    | "exento"
    | "consumidor_final"
    | "no_categorizado";

  /** Importe neto gravado. */
  neto: number;
  /** Neto de los conceptos exentos o a alícuota cero. */
  exento: number;
  iva: { alicuota: number; base: number; importe: number }[];
  tributos: { codigo: string; descripcion: string; base: number; alicuota: number; importe: number }[];
  total: number;

  /** Comprobante que corrige, en notas de crédito y débito. */
  asociado?: {
    tipo: TipoComprobante;
    puntoVenta: number;
    numero: number;
    fecha: Date;
  } | null;
}

export interface ResultadoAutorizacion {
  autorizado: boolean;
  cae?: string;
  caeVencimiento?: Date;
  /** Lo que contestó ARCA cuando rechazó, para poder corregir y reenviar. */
  observaciones?: string;
  /** Motivo del fallo cuando ni siquiera se pudo preguntar. */
  error?: string;
}

export interface EstadoProveedorFiscal {
  id: ProveedorFiscalId;
  /** Si está en condiciones de autorizar comprobantes ahora mismo. */
  operativo: boolean;
  ambiente: AmbienteArca | null;
  cuit: string | null;
  /** Qué falta para poder emitir con valor fiscal. */
  detalle: string | null;
  /** Si el servicio de ARCA responde. Null cuando no se pudo consultar. */
  servicioArriba?: boolean | null;
}

export interface ProveedorFiscal {
  readonly id: ProveedorFiscalId;
  estado(): Promise<EstadoProveedorFiscal>;
  autorizar(
    comprobante: ComprobanteAAutorizar,
  ): Promise<ResultadoAutorizacion>;
  /**
   * Último número autorizado por ARCA para ese punto de venta y tipo.
   *
   * Sirve para detectar que la numeración local se desincronizó de la de ARCA,
   * que es de las cosas que aparecen cuando alguien facturó desde otro sistema
   * con el mismo punto de venta.
   */
  ultimoAutorizado(
    puntoVenta: number,
    tipo: TipoComprobante,
  ): Promise<number | null>;
}
