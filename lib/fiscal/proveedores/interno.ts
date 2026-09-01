import "server-only";

import type {
  EstadoProveedorFiscal,
  ProveedorFiscal,
  ResultadoAutorizacion,
} from "./tipos";

/**
 * Proveedor interno: numera y emite, pero no autoriza.
 *
 * Es el que corre mientras el cliente no tenga el certificado digital de ARCA.
 * Permite operar —emitir, imprimir, cobrar, llevar el libro— y sobre todo
 * permite construir y probar todo lo demás.
 *
 * Devuelve `autorizado: false` a propósito y sin inventar un CAE. Un número de
 * autorización falso convertiría un comprobante inválido en uno que parece
 * válido, y eso lo descubre el contador o ARCA, no el sistema.
 */
export const proveedorInterno: ProveedorFiscal = {
  id: "interno",

  async estado(): Promise<EstadoProveedorFiscal> {
    return {
      id: "interno",
      operativo: false,
      ambiente: null,
      cuit: null,
      detalle:
        "Los comprobantes se numeran y se imprimen, pero no se envían a ARCA: falta el certificado digital.",
      servicioArriba: null,
    };
  },

  async autorizar(): Promise<ResultadoAutorizacion> {
    return {
      autorizado: false,
      observaciones:
        "Emitido sin autorización de ARCA. El comprobante no tiene valor fiscal hasta que se cargue el certificado y se lo reenvíe.",
    };
  },

  async ultimoAutorizado(): Promise<number | null> {
    // Sin ARCA no hay con qué comparar: la numeración local es la única que hay.
    return null;
  },
};
