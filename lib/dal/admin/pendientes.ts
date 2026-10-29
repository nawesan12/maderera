import "server-only";

import { api, apiInterna, datos } from "@/lib/api/servidor";
import type { RolStaff } from "@/lib/roles";

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
  /** Lo que no puede esperar se pinta; el resto se lee en gris. */
  urgente?: boolean;
}

/** Lo pendiente del rol de la sesión. */
export async function trabajoPendiente(): Promise<Pendiente[]> {
  return datos(await (await api()).GET("/api/v1/admin/inicio/pendientes"));
}

/**
 * Lo mismo, para un rol dado, **sin mirar la sesión**: solo para las tareas
 * programadas (`lib/tareas`), que corren sin nadie logueado. Va con el secreto
 * interno; una página nunca importa esto.
 */
export async function pendientesDelRol(staffRole: RolStaff): Promise<Pendiente[]> {
  return datos(await apiInterna.GET("/api/v1/admin/inicio/pendientes", { params: { query: { rol: staffRole } } }));
}
