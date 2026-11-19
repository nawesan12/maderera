"use client";

import Link from "next/link";
import { CircleHelp, Ellipsis, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * El formato del archivo y la guía, juntos en un menú en el teléfono. Los dos
 * botones sueltos, con el nombre del usuario y la vuelta al panel, empujaban
 * el encabezado a 453–508 px y la pantalla entera se corría de costado
 * (comité final, M16). Desde `md` siguen siendo botones a la vista: en la
 * computadora del aserradero sobra lugar y es un clic menos.
 */
export function MenuDelTaller() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Más opciones"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] border border-linea bg-card transition-colors hover:bg-hundida md:hidden"
      >
        <Ellipsis className="h-5 w-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem
          className="min-h-11 text-base"
          render={<Link href="/admin/cortes/formato" />}
        >
          <Settings2 className="h-5 w-5" />
          Formato del archivo para la máquina
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11 text-base"
          render={<Link href="/admin/ayuda/cortes-y-whatsapp" />}
        >
          <CircleHelp className="h-5 w-5" />
          Cómo se usa
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
