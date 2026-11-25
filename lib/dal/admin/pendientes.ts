import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Qué hay que hacer hoy: lo que contesta «qué tengo que hacer», que es la
 * pregunta con la que alguien abre el panel a las ocho de la mañana. Cada
 * renglón lleva a la pantalla que lo resuelve, y solo aparece lo que el rol
 * puede abrir (el mismo `ACCESO` del menú).
 *
 * Lo cuenta la API de Go (backend/internal/reportes/inicio.go).
 */

export interface Pendiente {
  clave: string;
  cantidad: number;
  /** Qué es, ya en plural o singular según la cantidad. */
  texto: string;
  /** Por qué importa hoy. Una línea. */
  detalle?: string;
  href: string;
  /** Lo que no puede esperar va en «Para hoy»; el resto, en «Pendientes». */
  urgente?: boolean;
  /** Ya pasó de fecha o se pierde: lo único que «Para hoy» pinta de rojo. */
  vencido?: boolean;
}

/** Lo pendiente del rol de la sesión. */
export async function trabajoPendiente(): Promise<Pendiente[]> {
  return datos(await (await api()).GET("/api/v1/admin/inicio/pendientes"));
}

