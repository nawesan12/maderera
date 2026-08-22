"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export function BotonSalir() {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function cerrarSesion() {
    setSaliendo(true);
    await authClient.signOut();
    // `refresh()` además del `push` porque el navbar y el carrito se arman en
    // el servidor con la sesión: sin esto seguirían mostrando a la persona
    // adentro hasta la próxima navegación completa.
    router.push("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={cerrarSesion}
      disabled={saliendo}
      className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
    >
      <LogOut className="h-4 w-4" />
      {saliendo ? "Cerrando…" : "Cerrar sesión"}
    </button>
  );
}
