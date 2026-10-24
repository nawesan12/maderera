"use server";

import { api, copiarCookies } from "@/lib/api/servidor";

/**
 * Cerrar la sesión: Go la borra de la base y devuelve las cookies vencidas,
 * que se le pasan al navegador. La usan el menú del panel y Mi cuenta.
 */
export async function cerrarSesion(): Promise<void> {
  const { response } = await (await api()).DELETE("/api/v1/sesion");
  await copiarCookies(response);
}
