"use server";

import { redirect } from "next/navigation";
import { renovarSenal } from "@/lib/senal-cliente";
import { adoptarCarritoAnonimo } from "@/lib/dal/carrito";
import { inicioDelRol } from "@/lib/roles";
import { api, copiarCookies, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * Entrar es de la API de Go (backend/internal/auth): valida, cuenta los
 * intentos por IP y por correo, y abre la sesión. Acá queda lo que es de Next:
 * pasarle la cookie al navegador, el carrito armado antes de entrar y a dónde
 * ir después.
 */

export interface EstadoIngreso {
  error?: string;
}

export async function ingresar(
  _estadoPrevio: EstadoIngreso,
  formData: FormData,
): Promise<EstadoIngreso> {
  const correo = String(formData.get("email") ?? "");
  const clave = String(formData.get("password") ?? "");
  const volver = formData.get("volver");

  let respuesta;
  try {
    respuesta = await (await api()).POST("/api/v1/sesion", { body: { correo, clave } });
  } catch (error) {
    // Go no respondió. Un fallo del login tiene que devolver una pantalla que
    // se pueda leer, no un 500.
    console.error(
      JSON.stringify({
        scope: "auth.ingresar",
        evento: "api_sin_respuesta",
        detalle: error instanceof Error ? error.message : "desconocido",
      }),
    );
    return { error: "No pudimos validar tus datos. Si el problema sigue, escribinos y lo revisamos." };
  }

  if (!respuesta.data) {
    // 422 (datos o clave), 429 (demasiados intentos) o un 500: el mensaje lo
    // arma Go. Para correo o clave equivocados es deliberadamente vago:
    // distinguirlos le confirmaría a un atacante qué cuentas existen.
    return { error: mensajeDe(respuesta.error as Problema | undefined, "No pudimos validar tus datos. Si el problema sigue, escribinos y lo revisamos.") };
  }

  await copiarCookies(respuesta.response);
  const sesion = respuesta.data;
  // El encabezado se dibuja en el navegador porque el HTML viene del CDN: sin
  // la señal prendida, no sabría que ahora hay un nombre que mostrar.
  await renovarSenal();
  // El presupuesto armado antes de entrar se le pasa a la cuenta.
  await adoptarCarritoAnonimo(sesion.userId);

  if (typeof volver === "string" && volver.startsWith("/") && !volver.startsWith("//")) redirect(volver);

  // Sin destino explícito, cada quien va a donde le sirve: el personal a su
  // pantalla, el cliente a su cuenta.
  redirect(sesion.rol === "staff" ? inicioDelRol(sesion.rolStaff) : "/mi-cuenta");
}

/**
 * Entra con un link mágico (ver `backend/internal/auth/enlace.go`). Se usa
 * con un botón y no al abrir la página: WhatsApp y los filtros de correo abren
 * los enlaces para armar la vista previa, y si con eso se gastara, el link
 * de un solo uso no le llegaría nunca a la persona.
 */
export async function entrarConEnlace(_previo: EstadoIngreso, formData: FormData): Promise<EstadoIngreso> {
  const token = String(formData.get("token") ?? "").slice(0, 100);
  let r;
  try {
    r = await (await api()).POST("/api/v1/sesion/enlace", { body: { token } });
  } catch {
    return { error: "No pudimos usar este link ahora. Probá en un rato." };
  }
  if (!r.data) {
    return { error: mensajeDe(r.error as Problema | undefined, "No pudimos usar este link. Pedí uno nuevo.") };
  }
  await copiarCookies(r.response);
  await renovarSenal();
  await adoptarCarritoAnonimo(r.data.sesion.userId);
  const rol = r.data.sesion.rolStaff;
  // La activación lleva a ponerse una clave: la cuenta la creó la aprobación
  // y no tiene ninguna.
  redirect(r.data.proposito === "activacion" ? "/mi-cuenta/datos#clave" : rol ? inicioDelRol(rol) : "/mi-cuenta");
}

export interface EstadoPedidoEnlace {
  error?: string;
  enviado?: boolean;
}

/** Pide el link de ingreso por correo. La respuesta no dice si la cuenta existe. */
export async function pedirEnlace(_previo: EstadoPedidoEnlace, formData: FormData): Promise<EstadoPedidoEnlace> {
  const correo = String(formData.get("email") ?? "");
  let r;
  try {
    r = await (await api()).POST("/api/v1/sesion/enlace/pedir", { body: { correo } });
  } catch {
    return { error: "No pudimos mandarlo. Probá en un rato." };
  }
  if (!r.response.ok) return { error: mensajeDe(r.error as Problema | undefined, "No pudimos mandarlo. Probá en un rato.") };
  return { enviado: true };
}
