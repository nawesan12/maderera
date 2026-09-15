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
 *
 * **El valor es un azar y cambia en cada inicio de sesión**, porque lo que el
 * navegador guarda de una sesión no le sirve a la siguiente. Antes era un `1`
 * fijo y eso abrió un agujero concreto: el profesional cierra sesión en la
 * computadora del mostrador, entra el siguiente en la misma pestaña, y los
 * precios que quedaron guardados de la sesión anterior se le mostraban como
 * propios. El valor sigue sin decir quién es nadie: solo permite notar que ya
 * no es la misma sesión de antes.
 */
export const SENAL_ESTADO = "mjbj_estado";

const OPCIONES = {
  httpOnly: false,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 60,
  secure: process.env.NODE_ENV === "production",
} as const;

/** Un valor opaco y corto, distinto en cada sesión. */
function nuevoValor(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * La prende si no estaba. Se llama al crear un carrito.
 *
 * No pisa la que ya hay: agregar algo al presupuesto no cambia de sesión, y
 * rotar el valor ahí tiraría los precios que el navegador ya trajo para nada.
 */
export async function encenderSenal(): Promise<void> {
  const cajon = await cookies();
  if (cajon.get(SENAL_ESTADO)) return;
  cajon.set(SENAL_ESTADO, nuevoValor(), OPCIONES);
}

/**
 * La prende con un valor nuevo. Se llama al iniciar sesión y al registrarse.
 *
 * Es lo que le avisa al navegador que lo que guardó es de otra persona.
 */
export async function renovarSenal(): Promise<void> {
  (await cookies()).set(SENAL_ESTADO, nuevoValor(), OPCIONES);
}

/** La apaga. Al vaciar el presupuesto y al cerrar sesión. */
export async function apagarSenal(): Promise<void> {
  (await cookies()).delete(SENAL_ESTADO);
}
