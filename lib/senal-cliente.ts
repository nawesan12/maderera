import "server-only";
import { cookies } from "next/headers";

/**
 * La cookie que le avisa al navegador que hay algo que traer.
 *
 * El sitio público se sirve del CDN, así que el HTML que le llega a todo el
 * mundo es el mismo: no puede venir con el nombre de quien entró ni con el
 * contador del presupuesto. Eso lo completa el navegador después de cargar.
 *
 * Pero preguntarlo siempre sería cambiar un trabajo por otro: el visitante que
 * nunca se logueó ni agregó nada —que es casi todo el tráfico— haría un pedido
 * al servidor para que le contesten "no hay nada". La sesión y el carrito viven
 * en cookies `httpOnly`, invisibles para el navegador, así que hace falta una
 * señal que sí pueda leer.
 *
 * Esta cookie es exactamente eso y nada más: dice "hay algo", nunca qué. No
 * lleva datos, no autoriza nada y el servidor no la usa para decidir; quien
 * decide sigue siendo la cookie de sesión, que no salió de `httpOnly`. Si
 * alguien se la inventa a mano, lo único que consigue es que su propio
 * navegador haga un pedido de más y reciba un "no hay nada".
 */
export const SENAL_ESTADO = "mjbj_estado";

const OPCIONES = {
  httpOnly: false,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 60,
  secure: process.env.NODE_ENV === "production",
} as const;

/** La prende. Se llama al crear un carrito y al iniciar sesión. */
export async function encenderSenal(): Promise<void> {
  (await cookies()).set(SENAL_ESTADO, "1", OPCIONES);
}

/** La apaga. Al vaciar el presupuesto y al cerrar sesión. */
export async function apagarSenal(): Promise<void> {
  (await cookies()).delete(SENAL_ESTADO);
}
