/**
 * Los roles del panel.
 *
 * Vive fuera de `lib/dal/session.ts` porque eso es `server-only` y el menú
 * lateral es un componente de cliente. Acá no hay nada que consultar ni que
 * proteger: es el tipo y una función pura, y las dos partes necesitan las
 * mismas para no escribir la lista de roles dos veces.
 */
export type RolStaff = "admin" | "vendedor" | "deposito" | "aserradero";

/**
 * A dónde va cada rol cuando entra o cuando lo rebotan de una sección.
 *
 * El aserradero no arranca en el resumen: arranca en su pantalla. Mandarlo al
 * resumen sería mostrarle ventas del mes, que no es lo suyo y con lo que no
 * puede hacer nada.
 */
export function inicioDelRol(rol: RolStaff | null): string {
  return rol === "aserradero" ? "/taller" : "/admin";
}
