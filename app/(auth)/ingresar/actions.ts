"use server";

import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { adoptarCarritoAnonimo } from "@/lib/dal/carrito";

const ingresoSchema = z.object({
  email: z.email({ message: "Revisá el correo, no parece válido." }),
  password: z.string().min(1, { message: "Escribí tu contraseña." }),
  volver: z.string().optional(),
});

export interface EstadoIngreso {
  error?: string;
}

export async function ingresar(
  _estadoPrevio: EstadoIngreso,
  formData: FormData,
): Promise<EstadoIngreso> {
  const parsed = ingresoSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    volver: formData.get("volver") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  let userId: string;

  try {
    const ingreso = await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      // Deja que Better Auth escriba la cookie de sesión en la respuesta.
      asResponse: false,
      headers: new Headers(),
    });
    userId = ingreso.user.id;
  } catch (error) {
    if (error instanceof APIError) {
      // El mensaje es deliberadamente vago: distinguir "no existe ese mail" de
      // "la contraseña está mal" le confirma a un atacante qué cuentas existen.
      return { error: "El correo o la contraseña no coinciden." };
    }

    // Cualquier otro error se registra pero no se propaga: un fallo del login
    // tiene que devolver una pantalla que se pueda leer, no un 500. Pasó de
    // verdad con una cuenta cuyo hash quedó en un formato que Better Auth ya no
    // valida ("Invalid password hash"): el formulario tiraba error de servidor
    // y no había forma de saber qué estaba mal.
    console.error(
      JSON.stringify({
        scope: "auth.ingresar",
        evento: "error_inesperado",
        detalle: error instanceof Error ? error.message : "desconocido",
      }),
    );

    return {
      error:
        "No pudimos validar tus datos. Si el problema sigue, escribinos y lo revisamos.",
    };
  }

  // El presupuesto armado antes de entrar se le pasa a la cuenta.
  await adoptarCarritoAnonimo(userId);

  const destino = parsed.data.volver;
  if (destino && destino.startsWith("/")) redirect(destino);

  // Sin destino explícito, cada quien va a donde le sirve: el personal al
  // panel, el cliente a su cuenta. Mandar a todos a `/admin` hacía que un
  // cliente rebotara a la home apenas entraba, sin entender por qué.
  const [perfil] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  redirect(perfil?.role === "staff" ? "/admin" : "/mi-cuenta");
}
