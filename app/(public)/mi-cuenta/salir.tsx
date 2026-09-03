"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { SENAL_ESTADO } from "@/lib/senal-navegador";

export function BotonSalir() {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function cerrarSesion() {
    setSaliendo(true);
    await authClient.signOut();

    // El encabezado del sitio se completa en el navegador y solo pregunta si
    // la señal está prendida. Apagarla acá es lo que hace que el menú vuelva a
    // decir "Ingresar" en el acto; si no, seguiría preguntando —y recibiendo
    // "no hay nada"— hasta que el servidor la apague por su cuenta.
    document.cookie = `${SENAL_ESTADO}=; Max-Age=0; Path=/`;

    router.push("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={cerrarSesion}
      disabled={saliendo}
      className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
    >
      <LogOut className="h-4 w-4" />
      {saliendo ? "Cerrando…" : "Cerrar sesión"}
    </button>
  );
}
