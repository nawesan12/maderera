"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  confirmarImportacion,
  previsualizarImportacion,
  type VistaPreviaImportacion,
} from "./actions";

const moneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const money = (valor?: string) =>
  valor === undefined ? "—" : moneda.format(Number(valor));

/**
 * Importación de precios desde planilla.
 *
 * El paso intermedio de vista previa no es un lujo: una columna corrida o un
 * archivo de la semana pasada pueden reescribir el catálogo entero, y sin ver
 * la comparación antes nadie se entera hasta que un cliente reclama.
 */
export function DialogoImportar() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [previa, setPrevia] = useState<VistaPreviaImportacion | null>(null);
  const [leyendo, startLectura] = useTransition();
  const [aplicando, startAplicacion] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function elegirArchivo(archivo: File) {
    const datos = new FormData();
    datos.set("archivo", archivo);

    startLectura(async () => {
      const resultado = await previsualizarImportacion(datos);
      if (resultado.error) toast.error(resultado.error);
      setPrevia(resultado);
    });
  }

  function aplicar() {
    if (!previa) return;

    const cambios = previa.filas
      .filter((f) => f.estado === "cambia")
      .map((f) => ({
        sku: f.sku,
        generalNuevo: f.generalNuevo,
        profesionalNuevo: f.profesionalNuevo,
      }));

    const datos = new FormData();
    datos.set("cambios", JSON.stringify(cambios));

    startAplicacion(async () => {
      const resultado = await confirmarImportacion({}, datos);
      if (resultado.error) {
        toast.error(resultado.error);
        return;
      }
      toast.success(resultado.ok ?? "Precios actualizados.");
      cerrar();
      router.refresh();
    });
  }

  function cerrar() {
    setAbierto(false);
    setPrevia(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(valor) => (valor ? setAbierto(true) : cerrar())}
    >
      <DialogTrigger className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted">
        <Upload className="h-5 w-5" />
        Importar planilla
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar precios desde una planilla</DialogTitle>
        </DialogHeader>

        {!previa ? (
          <div className="space-y-4">
            <ol className="space-y-2 text-base text-muted-foreground">
              <li>
                1. Descargá la planilla con el botón <strong>Exportar</strong>.
              </li>
              <li>2. Cambiá los precios en Excel y guardá el archivo.</li>
              <li>3. Subilo acá: antes de aplicar nada vas a ver qué cambia.</li>
            </ol>

            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors hover:border-brand-orange/50 hover:bg-muted/40">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-base font-medium">
                Elegí la planilla o arrastrala acá
              </span>
              <span className="text-sm text-muted-foreground">
                Archivo .csv guardado desde Excel · hasta 5 MB
              </span>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                  const archivo = e.target.files?.[0];
                  if (archivo) elegirArchivo(archivo);
                }}
              />
            </label>

            {leyendo && (
              <p className="flex items-center justify-center gap-2 text-base text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Leyendo la planilla…
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 rounded-xl border p-4">
              <Resumen valor={previa.cambian} etiqueta="cambian" destacado />
              <Resumen valor={previa.iguales} etiqueta="sin cambios" />
              <Resumen valor={previa.problemas} etiqueta="con problemas" />
            </div>

            {previa.problemas > 0 && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-base text-amber-900">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                Las filas con problemas se saltean. El resto se aplica igual.
              </p>
            )}

            <div className="max-h-80 overflow-y-auto rounded-xl border">
              <table className="w-full">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left">
                    <th className="px-3 py-2.5 text-sm font-medium text-muted-foreground">
                      Producto
                    </th>
                    <th className="px-3 py-2.5 text-right text-sm font-medium text-muted-foreground">
                      Lista
                    </th>
                    <th className="px-3 py-2.5 text-right text-sm font-medium text-muted-foreground">
                      Profesional
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {previa.filas.map((fila) => (
                    <tr key={fila.linea} className="border-b last:border-0">
                      <td className="px-3 py-2.5">
                        <p className="text-base">
                          {fila.producto ?? fila.sku}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {fila.detalle ?? `${fila.sku} · ${fila.medida ?? ""}`}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Comparacion
                          actual={fila.generalActual}
                          nuevo={fila.generalNuevo}
                          estado={fila.estado}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Comparacion
                          actual={fila.profesionalActual}
                          nuevo={fila.profesionalNuevo}
                          estado={fila.estado}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={aplicar}
                disabled={aplicando || previa.cambian === 0}
                className="flex-1 boton-accion"
              >
                {aplicando ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Aplicando…
                  </>
                ) : (
                  `Aplicar ${previa.cambian} cambio${previa.cambian === 1 ? "" : "s"}`
                )}
              </Button>
              <Button variant="outline" onClick={() => setPrevia(null)}>
                Elegir otra planilla
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Resumen({
  valor,
  etiqueta,
  destacado = false,
}: {
  valor: number;
  etiqueta: string;
  destacado?: boolean;
}) {
  return (
    <div>
      <p
        className={`tabular text-2xl font-semibold ${
          destacado && valor > 0 ? "text-brand-orange" : ""
        }`}
      >
        {valor}
      </p>
      <p className="text-sm text-muted-foreground">{etiqueta}</p>
    </div>
  );
}

function Comparacion({
  actual,
  nuevo,
  estado,
}: {
  actual?: string;
  nuevo?: string;
  estado: string;
}) {
  if (estado === "error" || estado === "sin-sku") {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  if (!nuevo) {
    return <span className="tabular text-base text-muted-foreground">{money(actual)}</span>;
  }

  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="tabular text-sm text-muted-foreground line-through">
        {money(actual)}
      </span>
      <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span className="tabular text-base font-medium">{money(nuevo)}</span>
    </span>
  );
}
