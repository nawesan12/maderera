"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { SENAL_ESTADO } from "@/lib/senal-navegador";
import { olvidarEstado } from "@/lib/estado-context";

export function BotonSalir() {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function cerrarSesion() {
    setSaliendo(true);
    await authClient.signOut();

    // Sin señal, el servidor no busca nada de quien mira: el menú vuelve a
    // decir "Ingresar" sin una sola consulta. Si quedara prendida, cada página
    // preguntaría —y recibiría "no hay nada"— hasta que se apagara sola.
    document.cookie = `${SENAL_ESTADO}=; Max-Age=0; Path=/`;

    // El encabezado vive en el layout y no se rearma al navegar: que vuelva a
    // preguntar ya, sin esperar al refresco. Los precios no hace falta
    // tocarlos —ya no quedan guardados en la pestaña: cada página los trae
    // del servidor con la sesión del momento—.
    olvidarEstado();

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
