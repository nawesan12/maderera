"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bell,
  Building2,
  ClipboardList,
  DollarSign,
  FileText,
  Package,
  Pencil,
  Scissors,
  Tag,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { haceCuanto } from "@/lib/formato";

export interface EventoDeActividad {
  id: string;
  usuario: string;
  accion: string;
  entidad: string;
  descripcion: string;
  fecha: Date;
}

/**
 * El ícono sale de la entidad tocada, no de la acción: lo que se busca al abrir
 * la campana es "¿qué pasó con los pedidos?", no "¿qué se editó?".
 */
const ICONOS: Record<string, LucideIcon> = {
  pedido: Package,
  presupuesto: ClipboardList,
  corte: Scissors,
  cliente: Users,
  producto: Tag,
  precio: DollarSign,
  stock: Package,
  factura: FileText,
  pago: DollarSign,
  sucursal: Building2,
};

/**
 * El color del icono según de qué es el evento.
 *
 * Sale de las mismas familias que los estados en vez de tonos sueltos de
 * Tailwind: así tiene su variante en modo oscuro sin repetir la paleta, y un
 * evento de stock se ve del mismo color que un estado con problema, que es lo
 * que efectivamente es.
 */
const COLORES: Record<string, string> = {
  pedido: "estado-marca bg-[var(--estado-fondo)] text-[var(--estado-tinta)]",
  presupuesto: "estado-info bg-[var(--estado-fondo)] text-[var(--estado-tinta)]",
  corte: "estado-espera bg-[var(--estado-fondo)] text-[var(--estado-tinta)]",
  cliente: "estado-ok bg-[var(--estado-fondo)] text-[var(--estado-tinta)]",
  precio: "estado-cerrado bg-[var(--estado-fondo)] text-[var(--estado-tinta)]",
  stock: "estado-problema bg-[var(--estado-fondo)] text-[var(--estado-tinta)]",
};

export function PanelDeActividad({ eventos }: { eventos: EventoDeActividad[] }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <Sheet open={abierto} onOpenChange={setAbierto}>
      <SheetTrigger aria-label="Actividad reciente del panel">
        <span className="relative flex cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground">
          <Bell className="h-5 w-5" />
          <span className="sr-only">Actividad reciente del panel</span>
          {eventos.length > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand-orange"
            />
          )}
        </span>
      </SheetTrigger>

      <SheetContent className="w-[380px] bg-card text-foreground">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-brand-orange" />
            Actividad reciente
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 max-h-[calc(100vh-9rem)] space-y-1 overflow-y-auto px-1">
          {eventos.length === 0 && (
            <p className="px-3 py-8 text-center text-base text-muted-foreground">
              Todavía no hay movimientos registrados en el panel.
            </p>
          )}

          {eventos.map((evento) => {
            const Icono = ICONOS[evento.entidad] ?? Pencil;
            const color =
              COLORES[evento.entidad] ?? "bg-muted text-muted-foreground";

            return (
              <div key={evento.id} className="flex items-start gap-3 rounded-lg p-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${color}`}
                >
                  <Icono className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-base leading-relaxed">{evento.descripcion}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {evento.usuario} · {haceCuanto(new Date(evento.fecha))}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 border-t px-4 pt-3">
          <Link
            href="/admin/bitacora"
            onClick={() => setAbierto(false)}
            className="text-base font-medium text-brand-orange hover:underline"
          >
            Ver la bitácora completa
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
