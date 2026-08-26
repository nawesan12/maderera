"use client";

import { useActionState } from "react";
import { Check, Loader2, TriangleAlert, Upload } from "lucide-react";
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
    <section className="tarjeta p-5">
      <h2 className="text-base font-medium">Publicar un documento</h2>
      <p className="mt-0.5 text-base text-muted-foreground">
        PDF, planilla o imagen. Aparece en el portal apenas se sube.
      </p>

      <form action={accion} className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
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

        <div className="sm:col-span-2">
          <label htmlFor="descripcion" className="block text-base font-medium">
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
          <label htmlFor="categoria" className="block text-base font-medium">
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

        <label className="flex items-center gap-2 text-base sm:col-span-2">
          <input
            type="checkbox"
            name="soloProfesionales"
            defaultChecked
            className="h-4 w-4"
          />
          Solo lo ven los profesionales aprobados
        </label>

        {estado.error && (
          <p className="flex items-start gap-2 text-base text-destructive sm:col-span-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {estado.error}
          </p>
        )}

        {estado.ok && (
          <p className="flex items-center gap-2 text-base text-muted-foreground sm:col-span-2">
            <Check className="h-4 w-4 text-brand-green" />
            {estado.ok}
          </p>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={subiendo}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
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
