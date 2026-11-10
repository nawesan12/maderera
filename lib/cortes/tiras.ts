/**
 * Tiras por metro lineal: «necesito 12 metros de tiras de 80 mm».
 *
 * Una tira corre a lo largo de la placa, con la veta, así que cada una sale
 * del largo de la placa (o de la media, si sale de media). Se piden tantas
 * como hagan falta para cubrir los metros, redondeando para arriba: nadie
 * pide 11,6 m y se lleva 11.
 */
export interface PedidoDeTiras {
  /** Ancho de cada tira, en milímetros. */
  anchoMm: number;
  /** Metros lineales en total. */
  metros: number;
  /** Lados largos con tapacanto: 0, 1 o 2. */
  cantoLargo: number;
}

export interface TirasCalculadas {
  largoMm: number;
  anchoMm: number;
  cantidad: number;
  respetaVeta: number;
  cantoLargo: number;
  cantoAncho: number;
  etiqueta: string | null;
}

export function tirasDePlaca(pedido: PedidoDeTiras, largoDePlacaMm: number): TirasCalculadas | null {
  const ancho = Math.round(pedido.anchoMm);
  if (!(ancho > 0) || !(pedido.metros > 0) || !(largoDePlacaMm > 0)) return null;
  const largo = Math.floor(largoDePlacaMm);
  return {
    largoMm: largo,
    anchoMm: ancho,
    cantidad: Math.ceil((pedido.metros * 1000) / largo - 1e-9),
    respetaVeta: 1,
    cantoLargo: Math.min(2, Math.max(0, Math.round(pedido.cantoLargo))),
    cantoAncho: 0,
    etiqueta: null,
  };
}
