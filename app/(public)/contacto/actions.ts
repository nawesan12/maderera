"use server";

import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/**
 * La consulta del formulario de contacto.
 *
 * Antes esto no existía: el botón ponía "Mensaje enviado correctamente" y no
 * mandaba nada a ningún lado. Los campos ni siquiera tenían `name`.
 *
 * La regla que gobierna todo el archivo: **solo se confirma lo que salió**. Si
 * el correo no está conectado la acción lo dice y ofrece WhatsApp, que sí
 * funciona. Decirle a alguien que su consulta llegó cuando se perdió es peor
 * que no tener formulario.
 *
 * La valida, la frena (3 por hora por IP y por correo) y la manda la API de
 * Go (backend/internal/contenido/sitio.go), con el texto escapado: lo escribe
 * cualquiera y termina en la bandeja de quien atiende.
 */

export interface EstadoConsulta {
  error?: string;
  ok?: string;
  usarWhatsapp?: boolean;
}

export async function enviarConsulta(_previo: EstadoConsulta, datos: FormData): Promise<EstadoConsulta> {
  const telefono = String(datos.get("telefono") ?? "").trim();
  const r = await (await api()).POST("/api/v1/contenido/contacto", {
    body: {
      nombre: String(datos.get("nombre") ?? ""),
      email: String(datos.get("email") ?? ""),
      motivo: String(datos.get("motivo") ?? ""),
      mensaje: String(datos.get("mensaje") ?? ""),
      ...(telefono ? { telefono } : {}),
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };

  if (r.data.resultado === "simulada") {
    return {
      usarWhatsapp: true,
      error:
        "Todavía no tenemos conectado el envío de correo, así que este mensaje no llegaría. Escribinos por WhatsApp y te contestamos ahora.",
    };
  }
  if (r.data.resultado === "fallida") {
    return {
      usarWhatsapp: true,
      error: "No pudimos enviar la consulta. Probá por WhatsApp o llamanos y lo resolvemos al toque.",
    };
  }
  return { ok: "Recibimos tu consulta. Te contestamos al correo que dejaste." };
}
