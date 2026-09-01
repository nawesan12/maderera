"use client";

import { Check, CircleAlert } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DefinicionEntidad, Mapeo } from "@/lib/migracion/entidades";

const SIN_MAPEAR = "-1";

/**
 * Mapeo de columnas: qué columna del archivo es cada cosa.
 *
 * Es la pantalla que permite haber escrito todo el módulo sin conocer la
 * exportación del sistema anterior, y por eso es la que más cuidado tiene: al
 * lado de cada campo se muestra **el primer valor real del archivo**. Elegir
 * una columna por su nombre y no ver el dato es exactamente como se termina
 * migrando el teléfono adentro del CUIT.
 */
export function PasoMapeo({
  definicion,
  columnas,
  primeraFila,
  mapeo,
  onCambio,
}: {
  definicion: DefinicionEntidad;
  columnas: string[];
  primeraFila: string[];
  mapeo: Mapeo;
  onCambio: (clave: string, indice: number) => void;
}) {
  const opciones = {
    [SIN_MAPEAR]: "— No está en el archivo —",
    ...Object.fromEntries(
      columnas.map((columna, i) => [String(i), columna || `Columna ${i + 1}`]),
    ),
  };

  const usadas = new Map<number, string>();
  for (const campo of definicion.campos) {
    const indice = mapeo[campo.clave] ?? -1;
    if (indice >= 0 && !usadas.has(indice)) usadas.set(indice, campo.clave);
  }

  return (
    <div className="space-y-3">
      {definicion.campos.map((campo) => {
        const indice = mapeo[campo.clave] ?? -1;
        const valor = indice >= 0 ? (primeraFila[indice] ?? "") : "";
        const repetida =
          indice >= 0 && usadas.get(indice) !== campo.clave;

        return (
          <div
            key={campo.clave}
            className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_minmax(0,20rem)] sm:items-start"
          >
            <div>
              <Label
                htmlFor={`campo-${campo.clave}`}
                className="text-base font-medium"
              >
                {campo.etiqueta}
                {campo.requerido && (
                  <span className="ml-1.5 text-brand-orange" aria-label="obligatorio">
                    *
                  </span>
                )}
              </Label>
              {campo.ayuda && (
                <p className="mt-0.5 text-sm text-muted-foreground">{campo.ayuda}</p>
              )}
              {campo.requerido && indice < 0 && (
                <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-brand-orange-dark">
                  <CircleAlert className="h-4 w-4" />
                  Sin esta columna no se puede migrar.
                </p>
              )}
              {repetida && (
                <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-brand-orange-dark">
                  <CircleAlert className="h-4 w-4" />
                  Esta columna ya está asignada a otro campo.
                </p>
              )}
            </div>

            <div>
              <Select
                value={String(indice)}
                onValueChange={(v) => v && onCambio(campo.clave, Number(v))}
                items={opciones}
              >
                <SelectTrigger id={`campo-${campo.clave}`} className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_MAPEAR}>— No está en el archivo —</SelectItem>
                  {columnas.map((columna, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {columna || `Columna ${i + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* El dato real, que es lo único que confirma que la columna es
                  la que uno cree. */}
              {indice >= 0 && (
                <p className="mt-1.5 truncate text-sm text-muted-foreground">
                  <Check className="mr-1 inline h-4 w-4 text-brand-green" />
                  Primer valor:{" "}
                  <span className="font-medium text-foreground">
                    {valor || "(vacío)"}
                  </span>
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
