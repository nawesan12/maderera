"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

export function MenuUsuario({
  nombre,
  iniciales,
  rol,
}: {
  nombre: string;
  iniciales: string;
  rol: string;
}) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function cerrarSesion() {
    setSaliendo(true);
    await authClient.signOut();
    router.push("/ingresar");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
          {iniciales}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight">{nombre}</span>
          <span className="block text-sm leading-tight text-muted-foreground">
            {rol}
          </span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <div className="px-2 py-1.5">
          <p className="text-base font-medium">{nombre}</p>
          <p className="text-sm text-muted-foreground">{rol}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={cerrarSesion} disabled={saliendo}>
          <LogOut className="h-5 w-5" />
          {saliendo ? "Cerrando…" : "Cerrar sesión"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
