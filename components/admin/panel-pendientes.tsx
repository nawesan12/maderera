"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export interface PendienteDeLaCampana {
  clave: string;
  cantidad: number;
  texto: string;
  href: string;
  vencido?: boolean;
}

/**
 * La campana de quien no es admin: lo suyo que espera, sin salir de la
 * pantalla en la que está (mes simulado, M2S1-191). La de actividad lee la
 * bitácora, que es del admin; a quien vende le servía otra cosa: el
 * presupuesto web que entró, la conversación que el bot le derivó, el
 * cliente para llamar. Son los mismos renglones urgentes de «Para hoy», con
 * la misma cifra y el mismo enlace.
 */
export function PanelDePendientes({ pendientes }: { pendientes: PendienteDeLaCampana[] }) {
  const [abierto, setAbierto] = useState(false);
  const hay = pendientes.length > 0;
  const titulo = hay ? `Lo tuyo para hoy: ${pendientes.length}` : "Lo tuyo para hoy";

  return (
    <Sheet open={abierto} onOpenChange={setAbierto}>
      <SheetTrigger aria-label={titulo}>
        <span className="relative flex min-h-11 min-w-11 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground">
          <Bell className="h-5 w-5" />
          {hay && (
            <span
              aria-hidden="true"
              className="tabular absolute right-0.5 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accion px-1 text-[12px] font-bold leading-none text-white"
            >
              {pendientes.length}
            </span>
          )}
        </span>
      </SheetTrigger>

      <SheetContent className="w-[380px] max-w-full bg-card text-foreground">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-brand-orange" />
            Para hoy
          </SheetTitle>
        </SheetHeader>

        <ul className="mt-4 max-h-[calc(100vh-9rem)] space-y-1 overflow-y-auto px-1">
          {!hay && (
            <li className="rounded-lg bg-hundida px-4 py-6 text-center text-base text-muted-foreground">
              Nada pendiente
            </li>
          )}
          {pendientes.map((p) => (
            <li key={p.clave}>
              <Link
                href={p.href}
                onClick={() => setAbierto(false)}
                className={`flex items-baseline gap-3 rounded-lg p-3 transition-colors hover:bg-muted/60 ${p.vencido ? "estado-problema" : ""}`}
              >
                <span
                  className={`tabular w-10 shrink-0 text-right text-[22px] font-extrabold leading-none ${
                    p.vencido ? "text-[var(--estado-tinta)]" : ""
                  }`}
                >
                  {p.cantidad}
                </span>
                <span className="min-w-0 flex-1 text-base font-semibold leading-snug">{p.texto}</span>
              </Link>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
