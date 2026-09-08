"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertCircle, Check, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { moneda } from "@/lib/formato";
import {
  aplicarLista,
  previsualizarLista,
  type EstadoLista,
  type VistaPreviaProveedor,
} from "./actions";

const inicial: EstadoLista = {};

/**
 * Importar la lista de precios de un proveedor.
 *
 * De las notas de la clienta: cada proveedor manda lo suyo —un Excel distinto
 * cada vez— y eso rompía el flujo de actualizar precios. El perfil guarda una
 * sola vez qué columna es qué, y el código con el que el proveedor llama a cada
 * producto queda guardado para que la próxima aparee sola.
 *
 * **La vista previa es obligatoria.** Una lista mal mapeada cambia el costo de
 * doscientos productos de una, y eso se descubre mirando el margen a fin de
 * mes.
 */
export function ImportadorDeLista({
  supplierId,
  perfil,
}: {
  supplierId: string;
  perfil: {
    columnaCodigo: string;
    columnaPrecio: string;
    columnaDescripcion: string | null;
    precioEsNeto: boolean;
    margenPorcentaje: string;
  } | null;
}) {
  const [vista, setVista] = useState<VistaPreviaProveedor | null>(null);
  /*
   * El mapeo con el que se generó la vista previa.
   *
   * Se guarda al previsualizar y se reenvía al aplicar. La alternativa era leer
   * los campos del formulario de arriba en el momento de aplicar, y eso deja
   * que alguien cambie una columna después de mirar la vista previa y aplique
   * algo distinto de lo que vio.
   */
  const [usado, setUsado] = useState<Record<string, string> | null>(null);
  const [mirando, mirar] = useTransition();
  const [estado, aplicar, aplicando] = useActionState(aplicarLista, inicial);

  // Las columnas que ofrece el select salen del archivo que se acaba de subir.
  const columnas = vista?.columnas ?? [];

  const apareadas = (vista?.filas ?? []).filter((f) => f.variantId);

  return (
    <section className="tarjeta">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
          Lista de precios del proveedor
        </h2>
        <p className="text-base text-muted-foreground">
          {perfil ? "Con el mapeo ya guardado" : "Primera vez: hay que mapearla"}
        </p>
      </div>

      <form
        action={(datos) =>
          mirar(async () => {
            setUsado({
              columnaCodigo: String(datos.get("columnaCodigo") ?? ""),
              columnaPrecio: String(datos.get("columnaPrecio") ?? ""),
              columnaDescripcion: String(datos.get("columnaDescripcion") ?? ""),
              margenPorcentaje: String(datos.get("margenPorcentaje") ?? "0"),
              precioEsNeto: datos.get("precioEsNeto") === "on" ? "on" : "",
            });
            setVista(await previsualizarLista(datos));
          })
        }
        className="space-y-4 px-5 py-4"
      >
        <input type="hidden" name="supplierId" value={supplierId} />

        <div>
          <label htmlFor="archivo" className="block text-base font-medium">
            El archivo que mandó
          </label>
          <input
            id="archivo"
            name="archivo"
            type="file"
            accept=".csv,.xlsx,text/csv"
            required
            className="mt-1 block w-full text-base file:mr-3 file:rounded-lg file:border file:bg-background file:px-3 file:py-2 file:text-base"
          />
          <p className="mt-1 text-sm text-muted-foreground">
            CSV o Excel (.xlsx). Un PDF hay que pasarlo a planilla antes: sacar
            una tabla de un PDF es adivinar, y adivinar precios de compra sale
            caro.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* El valor por defecto es lo último que se eligió y, si todavía no
              se eligió nada, lo que quedó guardado del perfil. Sin esto, al
              subir el archivo los campos se vuelven un desplegable y se
              reinician a la primera columna: alguien podía mirar una vista
              previa correcta y volver a importar con la columna equivocada. */}
          <Columna
            nombre="columnaCodigo"
            etiqueta="Columna del código"
            columnas={columnas}
            defecto={usado?.columnaCodigo || perfil?.columnaCodigo}
          />
          <Columna
            nombre="columnaPrecio"
            etiqueta="Columna del precio"
            columnas={columnas}
            defecto={usado?.columnaPrecio || perfil?.columnaPrecio}
          />
          <Columna
            nombre="columnaDescripcion"
            etiqueta="Columna de la descripción"
            columnas={columnas}
            defecto={
              usado?.columnaDescripcion || perfil?.columnaDescripcion || undefined
            }
            opcional
          />
          <div>
            <label htmlFor="margenPorcentaje" className="block text-base font-medium">
              Margen sobre el costo
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="margenPorcentaje"
                name="margenPorcentaje"
                inputMode="decimal"
                key={usado?.margenPorcentaje ?? perfil?.margenPorcentaje ?? "40"}
                defaultValue={
                  usado?.margenPorcentaje ?? perfil?.margenPorcentaje ?? "40"
                }
                className="tabular h-10 w-full rounded-lg border bg-background px-3 text-base"
              />
              <span className="text-base text-muted-foreground">%</span>
            </div>
          </div>
        </div>

        <label className="flex items-center gap-2 text-base">
          <input
            type="checkbox"
            name="precioEsNeto"
            key={usado ? usado.precioEsNeto : String(perfil?.precioEsNeto)}
            defaultChecked={
              usado ? usado.precioEsNeto === "on" : perfil?.precioEsNeto
            }
            className="h-4 w-4"
          />
          Los precios de la planilla vienen sin IVA
        </label>

        <button
          type="submit"
          disabled={mirando}
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
        >
          {mirando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Ver qué va a pasar
        </button>
      </form>

      {vista?.error && (
        <p className="flex items-start gap-2 border-t bg-destructive/10 px-5 py-3 text-base text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {vista.error}
          {vista.columnas.length > 0 && (
            <span className="block text-muted-foreground">
              El archivo trae: {vista.columnas.join(" · ")}
            </span>
          )}
        </p>
      )}

      {estado.error && (
        <p className="border-t bg-destructive/10 px-5 py-3 text-base text-destructive">
          {estado.error}
        </p>
      )}
      {estado.ok && (
        <p className="flex items-start gap-2 border-t bg-brand-green/10 px-5 py-3 text-base text-brand-green">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.ok}
        </p>
      )}

      {vista && !vista.error && vista.filas.length > 0 && (
        <div className="border-t">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3">
            <span className="text-base font-medium">
              {vista.apareadas} para actualizar
            </span>
            {vista.sinAparear > 0 && (
              <span className="text-base text-muted-foreground">
                {vista.sinAparear} sin aparear: no se tocan
              </span>
            )}
            {vista.problemas.length > 0 && (
              <span className="text-base text-brand-orange">
                {vista.problemas.length} con problemas
              </span>
            )}
          </div>

          <ul className="max-h-80 divide-y overflow-y-auto border-t">
            {vista.filas.slice(0, 100).map((f) => (
              <li
                key={f.codigo}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5"
              >
                <span className="min-w-[8rem] text-base">{f.codigo}</span>
                <span className="min-w-[12rem] flex-1 text-base text-muted-foreground">
                  {f.nuestro ?? f.descripcion ?? "—"}
                </span>
                {f.variantId ? (
                  <>
                    <span className="tabular text-base text-muted-foreground">
                      {f.precioActual !== null
                        ? moneda.format(f.precioActual)
                        : "sin precio"}
                    </span>
                    <span aria-hidden className="text-muted-foreground">→</span>
                    <span className="tabular text-base font-medium">
                      {moneda.format(f.precioSugerido)}
                    </span>
                  </>
                ) : (
                  <span className="text-base text-brand-orange">
                    No está en nuestro catálogo
                  </span>
                )}
              </li>
            ))}
          </ul>

          {vista.problemas.length > 0 && (
            <ul className="divide-y border-t bg-muted/40">
              {vista.problemas.slice(0, 20).map((p) => (
                <li key={p.fila} className="px-5 py-2 text-base text-muted-foreground">
                  Fila {p.fila}: {p.motivo}
                </li>
              ))}
            </ul>
          )}

          {apareadas.length > 0 && (
            <form action={aplicar} className="border-t px-5 py-4">
              <input type="hidden" name="supplierId" value={supplierId} />
              {/* El mismo mapeo con el que se armó la vista previa: lo que se
                  aplica es exactamente lo que se miró. */}
              <input type="hidden" name="columnaCodigo" value={usado?.columnaCodigo ?? ""} />
              <input type="hidden" name="columnaPrecio" value={usado?.columnaPrecio ?? ""} />
              <input
                type="hidden"
                name="columnaDescripcion"
                value={usado?.columnaDescripcion ?? ""}
              />
              <input
                type="hidden"
                name="margenPorcentaje"
                value={usado?.margenPorcentaje ?? "0"}
              />
              {usado?.precioEsNeto === "on" && (
                <input type="hidden" name="precioEsNeto" value="on" />
              )}
              <input
                type="hidden"
                name="filas"
                value={JSON.stringify(
                  apareadas.map((f) => ({
                    codigo: f.codigo,
                    variantId: f.variantId,
                    costo: f.costo,
                    precioSugerido: f.precioSugerido,
                  })),
                )}
              />
              <button
                type="submit"
                disabled={aplicando}
                className="boton-accion inline-flex h-10 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-60"
              >
                {aplicando && <Loader2 className="h-4 w-4 animate-spin" />}
                Aplicar {apareadas.length} precios
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

function Columna({
  nombre,
  etiqueta,
  columnas,
  defecto,
  opcional = false,
}: {
  nombre: string;
  etiqueta: string;
  columnas: string[];
  defecto?: string;
  opcional?: boolean;
}) {
  return (
    <div>
      <label htmlFor={nombre} className="block text-base font-medium">
        {etiqueta}
      </label>
      {columnas.length > 0 ? (
        <select
          id={nombre}
          name={nombre}
          key={`select-${defecto ?? ""}`}
          defaultValue={defecto}
          className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
        >
          {opcional && <option value="">Ninguna</option>}
          {columnas.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : (
        // Antes de subir el archivo no se sabe qué columnas tiene, así que se
        // escribe a mano o se deja lo que ya estaba guardado.
        <input
          id={nombre}
          name={nombre}
          defaultValue={defecto}
          placeholder={opcional ? "Opcional" : "Codigo"}
          className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
        />
      )}
    </div>
  );
}
