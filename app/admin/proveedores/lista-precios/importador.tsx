"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { AlertCircle, ArrowDown, ArrowUp, Check, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Confirmar } from "@/components/admin/confirmar";
import { moneda } from "@/lib/formato";
import {
  aplicarLista,
  previsualizarLista,
  type EstadoLista,
  type VistaPreviaProveedor,
} from "./actions";

const inicial: EstadoLista = {};

/** Una fila apareada que no cambia ni el costo ni el precio. */
function sinCambios(f: FilaPrevia) {
  // Al centavo: el costo guardado (el promedio) trae más decimales que la lista.
  const centavos = (v: number) => Math.round(v * 100);
  return (
    (f.cambio === "igual" || f.cambio === "sin_sugerido") &&
    f.costoAnterior !== null &&
    centavos(f.costoAnterior) === centavos(f.costoNeto)
  );
}

/**
 * Las filas que se aplican de entrada: todo lo apareado que cambia, menos lo
 * que baja el precio de venta (M2S1-001, M2S1-003: una lista mal leída
 * bajaba de un clic los precios de productos reales). Lo que baja queda en
 * rojo y hay que tildarlo a propósito.
 */
function deEntrada(filas: FilaPrevia[]) {
  return new Set(filas.filter((f) => f.variantId && !sinCambios(f) && f.cambio !== "baja").map((f) => f.codigo));
}

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
type FilaPrevia = VistaPreviaProveedor["filas"][number];

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
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const formAplicar = useRef<HTMLFormElement>(null);
  // Después de aplicar, la vista previa ya no se ofrece de nuevo: el botón
  // seguía activo y se podía volver a tocar (M2S3-056).
  const [aplicada, setAplicada] = useState(false);
  const [estado, aplicar, aplicando] = useActionState(async (previo: EstadoLista, datos: FormData) => {
    const r = await aplicarLista(previo, datos);
    if (r.ok) {
      setAplicada(true);
      setConfirmando(false);
    }
    return r;
  }, inicial);

  /*
   * Las columnas que ofrece el select salen del archivo apenas se elige: la
   * primera vez había que tocar «Ver qué va a pasar», comerse «Elegí la
   * columna del código» y volver a elegir el archivo (M4-005, M4-038).
   */
  const [leidas, setLeidas] = useState<string[]>([]);
  const columnas = vista?.columnas?.length ? vista.columnas : leidas;
  const propuesta = (patron: RegExp) => columnas.find((c) => patron.test(c.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));

  function leerColumnas(archivo: File | undefined) {
    setLeidas([]);
    if (!archivo) return;
    const datos = new FormData();
    datos.set("supplierId", supplierId);
    datos.set("archivo", archivo);
    void previsualizarLista(datos).then((v) => setLeidas(v.columnas ?? []));
  }

  const apareadas = (vista?.filas ?? []).filter((f) => f.variantId);
  const conCambios = apareadas.filter((f) => !sinCambios(f));
  const aAplicar = conCambios.filter((f) => elegidas.has(f.codigo));
  const quietas = apareadas.length - conCambios.length;
  const noApareadas = (vista?.filas ?? []).filter((f) => !f.variantId);
  /*
   * El botón cuenta lo que va a pasar: sin costo previo no hay precio
   * sugerido y el renglón solo guarda el costo. Decía «Aplicar 3 precios» y
   * el resultado era «0 precios actualizados y 3 costos guardados» (mes 23).
   * La cuenta es la de compras.AplicarLista.
   */
  const conPrecio = aAplicar.filter(
    (f) => f.precioSugerido > 0 && (f.precioActual === null || Math.round(f.precioActual * 100) !== Math.round(f.precioSugerido * 100)),
  ).length;
  const soloCosto = aAplicar.length - conPrecio;
  // Sin nada tildado, el botón apagado no cuenta «0 costos» (mes 23).
  const textoAplicar =
    aAplicar.length === 0
      ? "Aplicar"
      : conPrecio === 0
      ? `Guardar ${soloCosto === 1 ? "1 costo" : `${soloCosto} costos`}`
      : `Aplicar ${conPrecio === 1 ? "1 precio" : `${conPrecio} precios`}${soloCosto > 0 ? ` y ${soloCosto === 1 ? "1 costo" : `${soloCosto} costos`}` : ""}`;

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

      {/* Con onSubmit y no con `action`: React vacía el formulario después de
          una acción, y el archivo elegido se perdía (M4-005). */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const datos = new FormData(e.currentTarget);
          mirar(async () => {
            setUsado({
              columnaCodigo: String(datos.get("columnaCodigo") ?? ""),
              columnaPrecio: String(datos.get("columnaPrecio") ?? ""),
              columnaDescripcion: String(datos.get("columnaDescripcion") ?? ""),
              margenPorcentaje: String(datos.get("margenPorcentaje") ?? "0"),
              precioEsNeto: datos.get("precioEsNeto") === "on" ? "on" : "",
            });
            const v = await previsualizarLista(datos);
            setVista(v);
            setElegidas(deEntrada(v.filas));
            setAplicada(false);
          });
        }}
        className="space-y-4 px-5 py-4"
      >
        <input type="hidden" name="supplierId" value={supplierId} />

        <div>
          <label htmlFor="archivo" className="block text-base font-medium">
            El archivo que mandó
          </label>
          {/* El control del navegador dice «Choose File / No file chosen» en
              inglés (mes simulado, H014): el campo queda oculto y el botón y
              el nombre del archivo, en castellano. */}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-3">
            <label
              htmlFor="archivo"
              className="tarjeta-hundida inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg px-4 text-base font-medium focus-within:ring-2 focus-within:ring-ring"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Elegir archivo
            </label>
            <span className="min-w-0 truncate text-base text-muted-foreground">{nombreArchivo ?? "Ninguno elegido"}</span>
          </div>
          <input
            id="archivo"
            name="archivo"
            type="file"
            accept=".csv,.xlsx,text/csv"
            required
            onChange={(e) => {
              setNombreArchivo(e.target.files?.[0]?.name ?? null);
              leerColumnas(e.target.files?.[0]);
            }}
            className="sr-only"
          />
          {/* Un PDF no: sacar una tabla de un PDF es adivinar, y adivinar precios de compra sale caro. */}
          <p className="mt-1 text-sm text-muted-foreground">
            CSV o Excel (.xlsx). Un PDF hay que pasarlo a planilla antes.
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
            defecto={usado?.columnaCodigo || perfil?.columnaCodigo || propuesta(/c(o|ó)d|sku|art/i)}
          />
          <Columna
            nombre="columnaPrecio"
            etiqueta="Columna del precio"
            columnas={columnas}
            defecto={usado?.columnaPrecio || perfil?.columnaPrecio || propuesta(/precio|costo|importe|valor/i)}
          />
          <Columna
            nombre="columnaDescripcion"
            etiqueta="Columna de la descripción"
            columnas={columnas}
            defecto={
              usado?.columnaDescripcion || perfil?.columnaDescripcion || propuesta(/desc|detalle|producto|nombre/i)
            }
            opcional
          />
          {/* Vacío es «el margen que ya tiene cada producto»: el precio se
              mueve en la misma proporción que el costo. Antes venía en 40 y
              proponía bajar precios reales (M2S1-001). No se toma el del
              perfil guardado: un margen en blanco se guarda como 0. */}
          <div>
            <label htmlFor="margenPorcentaje" className="block text-base font-medium">
              Margen sobre el costo
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="margenPorcentaje"
                name="margenPorcentaje"
                inputMode="decimal"
                key={usado?.margenPorcentaje ?? ""}
                defaultValue={usado?.margenPorcentaje ?? ""}
                placeholder="El de cada producto"
                className="tabular h-10 w-full rounded-lg border bg-background px-3 text-base"
              />
              <span className="text-base text-muted-foreground">%</span>
            </div>
          </div>
        </div>

        {/* El IVA, junto al botón: las listas de un proveedor inscripto
            vienen netas, así que la primera vez arranca tildada (M2S1-003). */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
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
          <label className="flex min-h-10 items-center gap-2 text-base">
            <input
              type="checkbox"
              name="precioEsNeto"
              key={usado ? usado.precioEsNeto : String(perfil?.precioEsNeto ?? true)}
              defaultChecked={usado ? usado.precioEsNeto === "on" : (perfil?.precioEsNeto ?? true)}
              className="h-5 w-5"
            />
            Precios sin IVA
          </label>
        </div>
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

      {vista && !vista.error && vista.filas.length > 0 && !aplicada && (
        <div className="border-t">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3">
            <span className="text-base font-medium">
              {conCambios.length} para actualizar
            </span>
            {quietas > 0 && (
              <span className="text-base text-muted-foreground">{quietas} sin cambios</span>
            )}
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

          {/* Cada renglón: el costo de antes y el de ahora arriba, chico;
              el precio de venta abajo, grande, con flecha y color si sube o
              baja. Lo que baja arranca destildado. */}
          <ul className="max-h-[32rem] divide-y overflow-y-auto border-t">
            {[...conCambios, ...noApareadas].slice(0, 100).map((f) => {
              const baja = f.cambio === "baja";
              const sube = f.cambio === "sube" || f.cambio === "nuevo";
              return (
                <li key={f.codigo} className={`flex items-start gap-3 px-5 py-3 ${baja ? "bg-saldo-debe/5" : ""}`}>
                  {f.variantId ? (
                    <input
                      type="checkbox"
                      checked={elegidas.has(f.codigo)}
                      onChange={(e) =>
                        setElegidas((prev) => {
                          const n = new Set(prev);
                          if (e.target.checked) n.add(f.codigo);
                          else n.delete(f.codigo);
                          return n;
                        })
                      }
                      aria-label={`Aplicar ${f.nuestro ?? f.codigo}`}
                      className="mt-1 h-5 w-5 shrink-0"
                    />
                  ) : (
                    <span className="h-5 w-5 shrink-0" aria-hidden />
                  )}
                  {/* Si el nombre y los importes no entran juntos, los
                      importes bajan de renglón: a 375 px el nombre quedaba
                      con una palabra por línea (mes 23). */}
                  <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0 flex-[1_1_11rem]">
                    <p className="text-base">{f.nuestro ?? f.descripcion ?? "—"}</p>
                    <p className="codigo text-sm text-muted-foreground">{f.codigo}</p>
                  </div>
                  {f.variantId ? (
                    <div className="ml-auto shrink-0 text-right">
                      <p className="tabular text-sm text-muted-foreground">
                        {f.costoAnterior !== null ? moneda.format(f.costoAnterior) : "—"}
                        {" → "}
                        {moneda.format(f.costoNeto)}
                      </p>
                      <p
                        className={`tabular flex items-center justify-end gap-1 text-base font-medium ${
                          baja ? "text-saldo-debe" : sube ? "text-saldo-favor" : ""
                        }`}
                      >
                        {f.precioSugerido > 0 ? (
                          <>
                            <span className="font-normal text-muted-foreground">
                              {f.precioActual !== null ? moneda.format(f.precioActual) : "sin precio"}
                            </span>
                            {baja ? (
                              <ArrowDown className="h-4 w-4" aria-label="baja" />
                            ) : sube ? (
                              <ArrowUp className="h-4 w-4" aria-label="sube" />
                            ) : (
                              <span aria-hidden>→</span>
                            )}
                            {moneda.format(f.precioSugerido)}
                          </>
                        ) : (
                          <span className="font-normal text-muted-foreground">
                            {f.precioActual !== null ? moneda.format(f.precioActual) : "sin precio"}
                          </span>
                        )}
                      </p>
                    </div>
                  ) : (
                    <span className="ml-auto shrink-0 text-base text-brand-orange">No está en el catálogo</span>
                  )}
                  </div>
                </li>
              );
            })}
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

          {conCambios.length > 0 && (
            <form ref={formAplicar} action={aplicar} className="border-t px-5 py-4">
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
                  aAplicar.map((f) => ({
                    codigo: f.codigo,
                    variantId: f.variantId,
                    costo: f.costo,
                    costoNeto: f.costoNeto,
                    precioSugerido: f.precioSugerido,
                  })),
                )}
              />
              {/* Pide confirmar: cambia la lista general de un clic (M2S2-026). */}
              <button
                type="button"
                disabled={aplicando || aAplicar.length === 0}
                onClick={() => setConfirmando(true)}
                className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-5 text-base font-medium disabled:opacity-60"
              >
                {aplicando && <Loader2 className="h-4 w-4 animate-spin" />}
                {textoAplicar}
              </button>
              <Confirmar
                abierto={confirmando}
                alCerrar={() => setConfirmando(false)}
                titulo={textoAplicar}
                detalle={
                  conPrecio === 0
                    ? ""
                    : `Cambia la lista general. ${aAplicar.filter((f) => f.cambio === "baja").length > 0 ? "Hay precios que bajan." : ""}`.trim()
                }
                confirmar={textoAplicar}
                cancelar="Volver"
                pendiente={aplicando}
                alConfirmar={() => formAplicar.current?.requestSubmit()}
              />
            </form>
          )}
        </div>
      )}
    </section>
  );
}

/** Lo que suele decir el encabezado de cada columna en la planilla. */
const EJEMPLO: Record<string, string> = {
  columnaCodigo: "Código",
  columnaPrecio: "Precio",
  columnaDescripcion: "Descripción",
};

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
  const ejemplo = EJEMPLO[nombre] ?? "";
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
          placeholder={ejemplo || (opcional ? "Opcional" : "")}
          className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
        />
      )}
    </div>
  );
}
