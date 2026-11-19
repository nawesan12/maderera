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
 * La valida, la frena (3 por hora por IP y por correo o teléfono) y la manda la API de
 * Go (backend/internal/contenido/sitio.go), con el texto escapado: lo escribe
 * cualquiera y termina en la bandeja de quien atiende.
 */

export interface EstadoConsulta {
  error?: string;
  /**
   * El campo del error, para mostrarlo al lado del campo y no arriba de todo.
   * «contacto» es el par WhatsApp/correo: falta uno de los dos.
   */
  campo?: string;
  ok?: string;
  usarWhatsapp?: boolean;
  /** Lo que se había escrito, para no perderlo cuando vuelve con un error. */
  valores?: Record<string, string>;
}

export async function enviarConsulta(_previo: EstadoConsulta, datos: FormData): Promise<EstadoConsulta> {
  const leer = (campo: string) => String(datos.get(campo) ?? "").trim();
  const valores = Object.fromEntries(
    ["nombre", "telefono", "email", "motivo", "mensaje"].map((c) => [c, leer(c)]),
  );
  const { telefono, email } = valores;
  // WhatsApp o correo: alguno de los dos, y el que esté vacío no viaja. Lo
  // controla Go; acá solo se arma el pedido.
  const r = await (await api()).POST("/api/v1/contenido/contacto", {
    body: {
      nombre: valores.nombre,
      motivo: valores.motivo,
      mensaje: valores.mensaje,
      ...(telefono ? { telefono } : {}),
      ...(email ? { email } : {}),
    },
  });
  if (!r.data) {
    const problema = r.error as Problema | undefined;
    return {
      error: mensajeDe(problema, "Revisá los datos."),
      campo: problema?.errores ? Object.keys(problema.errores)[0] : undefined,
      valores,
    };
  }

  if (r.data.resultado === "simulada") {
    return {
      usarWhatsapp: true,
      valores,
      error:
        "Todavía no tenemos conectado el envío de correo, así que este mensaje no llegaría. Escribinos por WhatsApp y te contestamos ahora.",
    };
  }
  if (r.data.resultado === "fallida") {
    return {
      usarWhatsapp: true,
      valores,
      error: "No pudimos enviar la consulta. Probá por WhatsApp o llamanos y lo resolvemos al toque.",
    };
  }
  return {
    ok: telefono
      ? "Recibimos tu consulta. Te contestamos por WhatsApp."
      : "Recibimos tu consulta. Te contestamos al correo que dejaste.",
  };
}
