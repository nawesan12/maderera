import "server-only";

import {
  decodificarPlanilla,
  detectarSeparador,
  formatoBinario,
  partirPlanilla,
} from "@/lib/csv";
import { leerXlsx } from "@/lib/xlsx";

/**
 * Una planilla subida, venga como CSV o como .xlsx.
 *
 * Es el único punto por el que entra un archivo del cliente, y existe para que
 * la migración y la importación de precios no tengan cada una su propia idea
 * de qué formatos acepta el sistema. De acá para adelante las dos ven lo
 * mismo: una grilla de texto.
 */
export interface PlanillaLeida {
  filas: string[][];
  /** Cómo se leyó, para poder decirlo en pantalla y guardarlo en la corrida. */
  codificacion: string;
  error?: string;
}

/** Los binarios que sí se pueden leer, y los que no. */
const NO_SE_PUEDE: Record<"xls" | "pdf", string> = {
  xls: "un Excel viejo (.xls)",
  pdf: "un PDF",
};

export function leerPlanilla(datos: Uint8Array): PlanillaLeida {
  const binario = formatoBinario(datos);

  if (binario === "xlsx") {
    try {
      const { filas, hoja } = leerXlsx(datos);
      return { filas, codificacion: `xlsx · hoja "${hoja}"` };
    } catch (error) {
      return {
        filas: [],
        codificacion: "xlsx",
        error:
          error instanceof Error
            ? `No se pudo abrir el Excel: ${error.message}`
            : "No se pudo abrir el Excel.",
      };
    }
  }

  if (binario) {
    return {
      filas: [],
      codificacion: binario,
      error: `Esto es ${NO_SE_PUEDE[binario]}. Hace falta un Excel (.xlsx) o un CSV: si el sistema anterior solo exporta a este formato, abrilo en Excel y guardalo como .xlsx.`,
    };
  }

  const { texto, codificacion } = decodificarPlanilla(datos);
  const separador = detectarSeparador(texto);
  return { filas: partirPlanilla(texto, separador), codificacion };
}
