/**
 * Los tipos que comparten la pantalla del mostrador y sus acciones.
 *
 * La lógica que los usaba en el servidor (venta.ts, buscar.ts, caja.ts) se
 * mudó a Go (backend/internal/mostrador, internal/caja): quedan acá las
 * formas, para que la pantalla no dependa de un módulo de servidor.
 */

/** El despiece que se cargó en el mostrador, para que nazca el trabajo. */
export interface CorteDeMostrador {
  variantId: string | null;
  materialDescripcion: string;
  cantoDescripcion: string | null;
  /** La medida de la placa, para que el taller rehaga el mismo plano. */
  placaLargoMm: number | null;
  placaAnchoMm: number | null;
  /** De qué sale: placa entera (null) o media, y en qué sentido partida. */
  mitad: "largo" | "ancho" | null;
  placas: number;
  pasadas: number;
  /** El acomodo corregido a mano, como JSON. */
  acomodoManual: string | null;
  piezas: {
    largoMm: number;
    anchoMm: number;
    cantidad: number;
    respetaVeta: number;
    cantoLargo: number;
    cantoAncho: number;
    etiqueta: string | null;
    aclaracion: string | null;
  }[];
  /** El ancho de la sierra con que se armó el plano. */
  anchoSierraMm?: number | null;
}

/** Una variante del buscador del mostrador (o de la copia local). */
export interface ResultadoDeMostrador {
  variantId: string;
  sku: string;
  producto: string;
  medida: string;
  unidad: string;
  precio: number;
  /** Lo que hay en la sucursal donde se está vendiendo. */
  stock: number;
  /** Opcionales: la copia local no los guarda. */
  largoMm?: number | null;
  anchoMm?: number | null;
  color?: string | null;
  categoria?: string | null;
  formaDeVenta?: "entera" | "entera_o_media" | "metro_cuadrado";
  precioMediaPct?: number;
}

/** Una fila del cierre Z: cuánto entró por cada medio. */
export interface RenglonDelCierre {
  medioPago: string;
  cantidad: number;
  total: number;
}
