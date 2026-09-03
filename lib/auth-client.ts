"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Cliente de sesión del navegador.
 *
 * **Sin `baseURL` a propósito.** Better Auth cae a `/api/auth`, que es
 * relativo, así que apunta solo al sitio donde está corriendo: desarrollo,
 * cada vista previa y producción, sin una variable que mantener.
 *
 * Antes decía `process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"`, y
 * esa variable nunca se cargó en producción: el respaldo quedaba compilado
 * adentro del paquete que baja el navegador. El resultado es que **"Cerrar
 * sesión" no cerraba nada** —el pedido salía a `localhost:3000` desde la
 * máquina de quien estuviera usando el sitio— y fallaba en silencio.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
