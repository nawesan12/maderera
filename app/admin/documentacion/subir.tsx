"use client";

import { useActionState } from "react";
import {
  Check,
  FileText,
  HardHat,
  Loader2,
  Lock,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Hoja, Interruptor, Seccion } from "@/components/admin/formulario";
import { subirDocumento, type EstadoDocumento } from "./actions";

const inicial: EstadoDocumento = {};

/**
 * Alta de un documento técnico.
 *
 * `Solo profesionales` viene marcado: la documentación detallada es parte del
 * valor del acceso, y publicarla entera de entrada le saca sentido a pedirlo.
 * Se destilda a conciencia para lo que sirve como material de posicionamiento.
 */
export function SubirDocumento({ categorias }: { categorias: string[] }) {
  const [estado, accion, subiendo] = useActionState(subirDocumento, inicial);

  return (
    <section className="space-y-4">
      <h2 className="text-base font-medium">Publicar un documento</h2>

      <form action={accion} className="space-y-4">
        <Hoja>
          <Seccion titulo="Documento" icono={FileText}>
            <div className="md:col-span-2">
              <label htmlFor="titulo" className="block text-base font-medium">
                Título
              </label>
              <input
                id="titulo"
                name="titulo"
                required
                placeholder="Tabla de cargas admisibles — Pino elliottii"
                className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
              />
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="descripcion"
                className="block text-base font-medium"
              >
                Descripción
              </label>
              <input
                id="descripcion"
                name="descripcion"
                placeholder="Para cálculo de estructuras de techo"
                className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
              />
            </div>

            <div>
              <label
                htmlFor="categoria"
                className="block text-base font-medium"
              >
                Categoría
              </label>
              <input
                id="categoria"
                name="categoria"
                list="categorias-documentos"
                defaultValue={categorias[0] ?? "general"}
                className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
              />
              <datalist id="categorias-documentos">
                {categorias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div>
              <label htmlFor="archivo" className="block text-base font-medium">
                Archivo
              </label>
              <input
                id="archivo"
                name="archivo"
                type="file"
                required
                accept="application/pdf,image/jpeg,image/png,.xlsx,text/csv"
                className="mt-1 h-10 w-full rounded-lg border bg-background px-3 py-1.5 text-base"
              />
            </div>
          </Seccion>

          <Seccion titulo="Quién lo ve" icono={Lock} columnas={1}>
            <Interruptor
              nombre="soloProfesionales"
              etiqueta="Solo lo ven los profesionales aprobados"
              icono={HardHat}
              defecto
            />
          </Seccion>
        </Hoja>

        {estado.error && (
          <p className="flex items-start gap-2 text-base text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {estado.error}
          </p>
        )}

        {estado.ok && (
          <p className="flex items-center gap-2 text-base text-muted-foreground">
            <Check className="h-4 w-4 text-brand-green" />
            {estado.ok}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={subiendo}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
          >
            {subiendo ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Publicar
          </button>
        </div>
      </form>
    </section>
  );
}
