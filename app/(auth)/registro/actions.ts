"use server";

import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { adoptarCarritoAnonimo } from "@/lib/dal/carrito";

const registroSchema = z
  .object({
    nombre: z.string().trim().min(2, "Escribí tu nombre.").max(120),
    email: z.email({ message: "Revisá el correo, no parece válido." }),
    telefono: z
      .string()
      .trim()
      .min(6, "Dejanos un teléfono para coordinar las entregas.")
      .max(40),
    // Ocho caracteres es lo que exige Better Auth en `lib/auth-options.ts`;
    // pedir menos acá haría que el formulario acepte lo que el alta rechaza.
    password: z.string().min(8, "La contraseña necesita 8 caracteres o más."),
    repetir: z.string(),
    volver: z.string().optional(),
  })
  .refine((d) => d.password === d.repetir, {
    message: "Las dos contraseñas tienen que coincidir.",
    path: ["repetir"],
  });

export interface EstadoRegistro {
  error?: string;
}

/**
 * Alta de una cuenta de cliente.
 *
 * Deliberadamente NO se busca un cliente existente con el mismo correo para
 * vincularlo. Como el alta no verifica el mail (ver `lib/auth-options.ts`),
 * hacerlo permitiría registrarse con la dirección de un tercero y quedarse con
 * su historial y su cuenta corriente. Cada registro nace con su propia ficha, y
 * unificarla con la del mostrador es una decisión que toma el vendedor desde el
 * panel, que sabe con quién está hablando.
 */
export async function registrarse(
  _previo: EstadoRegistro,
  formData: FormData,
): Promise<EstadoRegistro> {
  const parsed = registroSchema.safeParse({
    nombre: formData.get("nombre"),
    email: formData.get("email"),
    telefono: formData.get("telefono"),
    password: formData.get("password"),
    repetir: formData.get("repetir"),
    volver: formData.get("volver") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const datos = parsed.data;

  try {
    const alta = await auth.api.signUpEmail({
      body: {
        name: datos.nombre,
        email: datos.email,
        password: datos.password,
      },
      asResponse: false,
      headers: new Headers(),
    });

    // El perfil con rol "cliente" lo crea el hook de Better Auth. Acá se suma la
    // ficha comercial, que es lo que después cuelga pedidos y presupuestos.
    await db.insert(customers).values({
      userId: alta.user.id,
      nombre: datos.nombre,
      email: datos.email,
      telefono: datos.telefono,
      tipo: "particular",
      limiteCredito: "0",
      notas: "Cuenta creada desde el sitio.",
    });

    // El presupuesto que venía armando sin sesión se le pasa a la cuenta nueva.
    await adoptarCarritoAnonimo(alta.user.id);
  } catch (error) {
    if (error instanceof APIError) {
      // Better Auth avisa cuando el correo ya existe. Acá sí conviene decirlo:
      // quien se está registrando necesita saber que tiene que ingresar en vez
      // de crear otra cuenta, y el dato no revela nada que un intento de alta
      // no revele igual.
      return {
        error:
          error.body?.code === "USER_ALREADY_EXISTS"
            ? "Ya hay una cuenta con ese correo. Probá ingresando."
            : "No pudimos crear la cuenta. Intentá de nuevo en un momento.",
      };
    }
    throw error;
  }

  const destino = datos.volver;
  redirect(destino && destino.startsWith("/") ? destino : "/mi-cuenta");
}
