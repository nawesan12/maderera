"use server";

import { redirect } from "next/navigation";
import { renovarSenal } from "@/lib/senal-cliente";
import { adoptarCarritoAnonimo } from "@/lib/dal/carrito";
import { api, copiarCookies, mensajeDe, type Problema } from "@/lib/api/servidor";

export interface EstadoRegistro {
  error?: string;
}

/**
 * Alta de una cuenta de cliente.
 *
 * La hace la API de Go (backend/internal/auth): usuario, perfil de cliente y
 * ficha comercial en una sola transacción, con el freno de cuántas cuentas
 * crea una IP por hora (el alta no verifica el correo todavía).
 *
 * Deliberadamente NO se busca un cliente existente con el mismo correo para
 * vincularlo: sin verificar el mail, permitiría registrarse con la dirección
 * de un tercero y quedarse con su historial y su cuenta corriente. Unificar la
 * ficha con la del mostrador lo decide el vendedor desde el panel.
 */
export async function registrarse(
  _previo: EstadoRegistro,
  formData: FormData,
): Promise<EstadoRegistro> {
  const texto = (k: string) => String(formData.get(k) ?? "");
  const clave = texto("password");
  // Que las dos coincidan es cosa del formulario: Go recibe una sola.
  if (clave !== texto("repetir")) {
    return { error: "Las dos contraseñas tienen que coincidir." };
  }

  let respuesta;
  try {
    respuesta = await (await api()).POST("/api/v1/registro", {
      body: { nombre: texto("nombre"), correo: texto("email"), telefono: texto("telefono"), clave },
    });
  } catch {
    return { error: "No pudimos crear la cuenta. Intentá de nuevo en un momento." };
  }
  if (!respuesta.data) {
    return { error: mensajeDe(respuesta.error as Problema | undefined, "No pudimos crear la cuenta. Intentá de nuevo en un momento.") };
  }

  await copiarCookies(respuesta.response);
  // El presupuesto que venía armando sin sesión se le pasa a la cuenta nueva.
  await adoptarCarritoAnonimo(respuesta.data.userId);
  // El encabezado se dibuja en el navegador porque el HTML viene del CDN: sin
  // la señal prendida, no sabría que ahora hay un nombre que mostrar.
  await renovarSenal();

  const destino = formData.get("volver");
  redirect(typeof destino === "string" && destino.startsWith("/") && !destino.startsWith("//") ? destino : "/mi-cuenta");
}
