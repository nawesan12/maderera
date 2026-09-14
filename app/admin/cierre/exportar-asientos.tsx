"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * El botón que baja los asientos para el estudio.
 *
 * Cuando hay asientos que no cierran, **pregunta antes de bajar el archivo**.
 * Antes el cartel decía "no exportes hasta revisarlos" y el botón de al lado se
 * apretaba igual: una advertencia que no frena nada es una advertencia que se
 * aprende a ignorar. Tampoco se deshabilita, porque a veces el contador quiere
 * el archivo igual para mirarlo — pero que sea una decisión y no un descuido.
 */
export function ExportarAsientos({
  periodo,
  rotos,
}: {
  periodo: string;
  rotos: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const href = `/admin/cierre/exportar?periodo=${periodo}`;

  if (rotos === 0) {
    return (
      <a
        href={href}
        className="inline-flex h-11 items-center gap-1.5 rounded-lg boton-accion px-4 text-base font-medium transition-colors"
      >
        <Download className="h-4 w-4" />
        Asientos en CSV
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-11 items-center gap-1.5 rounded-lg boton-accion px-4 text-base font-medium transition-colors"
      >
        <Download className="h-4 w-4" />
        Asientos en CSV
      </button>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {rotos === 1
                ? "Hay un asiento que no cierra"
                : `Hay ${rotos} asientos que no cierran`}
            </DialogTitle>
            <DialogDescription className="text-base">
              El sistema del estudio rechaza el archivo entero si viene un
              asiento donde el debe y el haber no dan igual. Están listados más
              abajo en esta pantalla, con la diferencia de cada uno.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="h-11 rounded-lg border border-linea px-4 text-base font-medium hover:bg-hundida"
            >
              Mejor los reviso
            </button>
            <a
              href={href}
              onClick={() => setAbierto(false)}
              className="inline-flex h-11 items-center rounded-lg boton-accion px-4 text-base font-medium"
            >
              Bajar el archivo igual
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
