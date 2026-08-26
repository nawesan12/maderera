"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  Download,
  FileSpreadsheet,
  Loader2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ENTIDADES,
  LOTE,
  definicionDe,
  faltantes,
  type ClaveEntidad,
  type Mapeo,
} from "@/lib/migracion/entidades";
import type { Control } from "@/lib/migracion/ejecutar";
import type { RechazoMigracion } from "@/lib/db/schema";
import {
  analizarArchivo,
  cerrarCorrida,
  ejecutarLote,
  iniciarCorrida,
  previsualizar,
  type ArchivoAnalizado,
  type VistaPrevia,
} from "./actions";
import { PasoMapeo } from "./paso-mapeo";

/**
 * Asistente de migración.
 *
 * Cuatro pasos y ninguno se puede saltear: elegir qué se migra, subir el
 * archivo, decir qué columna es cada cosa y mirar la vista previa antes de
 * escribir nada. El orden no es ceremonia: cada paso existe porque hay una
 * forma concreta de arruinar la migración que ese paso evita.
 *
 * El archivo se lee una sola vez y queda acá, en la pantalla. Los lotes se
 * mandan de a doscientas filas, y el avance se ve: una migración de veinte mil
 * artículos tarda, y una barra quieta durante tres minutos hace que alguien
 * cierre la pestaña a la mitad.
 */

type Paso = "entidad" | "archivo" | "mapeo" | "previa" | "corriendo" | "informe";

const INSTRUCCIONES: Record<ClaveEntidad, string> = {
  clientes:
    "En el sistema anterior: abrí el listado de Clientes, exportá la grilla a Excel y guardá el archivo como CSV UTF-8.",
  productos:
    "En el sistema anterior: abrí el listado de Artículos con las columnas de rubro y precios a la vista, exportá la grilla y guardala como CSV UTF-8.",
  stock:
    "En el sistema anterior: abrí el informe de existencias por depósito, exportá la grilla y guardala como CSV UTF-8. Los productos tienen que estar migrados antes.",
  saldos:
    "En el sistema anterior: abrí el resumen de cuentas corrientes al día del corte, exportá la grilla y guardala como CSV UTF-8. Los clientes tienen que estar migrados antes.",
};

interface Totales {
  creados: number;
  actualizados: number;
  omitidos: number;
  conError: number;
}

const CERO: Totales = { creados: 0, actualizados: 0, omitidos: 0, conError: 0 };

/** Arma el CSV de rechazos para poder mandárselo a quien tiene el sistema viejo. */
function descargarRechazos(entidad: ClaveEntidad, rechazos: RechazoMigracion[]) {
  const escapar = (texto: string) =>
    /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;

  const contenido =
    "﻿" +
    ["Linea;Identificador;Motivo"]
      .concat(
        rechazos.map((r) =>
          [String(r.linea), escapar(r.identificador), escapar(r.motivo)].join(";"),
        ),
      )
      .join("\r\n");

  const url = URL.createObjectURL(
    new Blob([contenido], { type: "text/csv;charset=utf-8" }),
  );

  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `migracion-${entidad}-rechazos.csv`;
  enlace.click();
  URL.revokeObjectURL(url);
}

export function AsistenteMigracion() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [paso, setPaso] = useState<Paso>("entidad");
  const [entidad, setEntidad] = useState<ClaveEntidad>("clientes");
  const [analisis, setAnalisis] = useState<ArchivoAnalizado | null>(null);
  const [mapeo, setMapeo] = useState<Mapeo>({});
  const [previa, setPrevia] = useState<VistaPrevia | null>(null);
  const [avance, setAvance] = useState(0);
  const [totales, setTotales] = useState<Totales>(CERO);
  const [rechazos, setRechazos] = useState<RechazoMigracion[]>([]);
  const [controles, setControles] = useState<Control[]>([]);

  const [leyendo, startLectura] = useTransition();
  const [validando, startValidacion] = useTransition();

  const definicion = useMemo(() => definicionDe(entidad), [entidad]);
  const filas = analisis?.filas ?? [];
  const sinMapear = faltantes(definicion, mapeo);

  function volverAlPrincipio() {
    setPaso("entidad");
    setAnalisis(null);
    setPrevia(null);
    setMapeo({});
    setAvance(0);
    setTotales(CERO);
    setRechazos([]);
    setControles([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function elegirArchivo(archivo: File) {
    const datos = new FormData();
    datos.set("archivo", archivo);

    startLectura(async () => {
      const resultado = await analizarArchivo(entidad, datos);

      if (resultado.error) {
        toast.error(resultado.error);
        return;
      }

      setAnalisis(resultado);
      setMapeo(resultado.mapeo ?? {});
      setPaso("mapeo");
    });
  }

  function validar() {
    startValidacion(async () => {
      const resultado = await previsualizar(entidad, mapeo, filas);

      if (resultado.error) {
        toast.error(resultado.error);
        return;
      }

      setPrevia(resultado);
      setPaso("previa");
    });
  }

  /**
   * Corre la migración lote por lote.
   *
   * Secuencial a propósito: en paralelo, dos lotes que crean la misma
   * categoría o el mismo producto se pisan, y el archivo de un sistema viejo
   * repite el nombre del producto en cada renglón.
   */
  async function correr() {
    setPaso("corriendo");
    setAvance(0);
    setTotales(CERO);
    setRechazos([]);

    const inicio = await iniciarCorrida(entidad, {
      archivo: analisis?.archivo ?? "archivo.csv",
      codificacion: analisis?.codificacion ?? "utf-8",
      mapeo,
      filasTotales: filas.length,
    });

    if (inicio.error || !inicio.runId) {
      toast.error(inicio.error ?? "No se pudo iniciar la migración.");
      setPaso("previa");
      return;
    }

    const acumulado = { ...CERO };
    const fallidas: RechazoMigracion[] = [];

    for (let desde = 0; desde < filas.length; desde += LOTE) {
      const lote = filas.slice(desde, desde + LOTE);
      const resultado = await ejecutarLote(inicio.runId, entidad, mapeo, lote);

      if (resultado.error) {
        toast.error(resultado.error);
        setRechazos(fallidas);
        setPaso("previa");
        return;
      }

      acumulado.creados += resultado.creados ?? 0;
      acumulado.actualizados += resultado.actualizados ?? 0;
      acumulado.omitidos += resultado.omitidos ?? 0;
      acumulado.conError += resultado.conError ?? 0;
      fallidas.push(...(resultado.rechazos ?? []));

      setTotales({ ...acumulado });
      setAvance(Math.min(desde + LOTE, filas.length));
    }

    const cierre = await cerrarCorrida(inicio.runId, entidad, mapeo, filas);

    setRechazos(fallidas);
    setControles(cierre.controles ?? []);
    setPaso("informe");
    router.refresh();
  }

  /* ------------------------------------------------------------------ */
  /* Paso 1 · qué se migra                                               */
  /* ------------------------------------------------------------------ */

  if (paso === "entidad") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {ENTIDADES.map((item) => (
          <button
            key={item.clave}
            onClick={() => {
              setEntidad(item.clave);
              setPaso("archivo");
            }}
            className="rounded-xl border bg-card p-5 text-left transition-colors hover:border-brand-orange/50 hover:bg-muted/40"
          >
            <p className="text-lg font-semibold">{item.titulo}</p>
            <p className="mt-1 text-base text-muted-foreground">{item.resumen}</p>
            <p className="mt-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Se identifica por:</span>{" "}
              {item.identidad}
            </p>
          </button>
        ))}
      </div>
    );
  }

  const encabezado = (
    <div className="mb-5 flex items-center gap-3">
      <button
        onClick={volverAlPrincipio}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
      >
        <ArrowLeft className="h-5 w-5" />
        Empezar de nuevo
      </button>
      <div>
        <p className="text-lg font-semibold">{definicion.titulo}</p>
        <p className="text-sm text-muted-foreground">{definicion.escribe}</p>
      </div>
    </div>
  );

  /* ------------------------------------------------------------------ */
  /* Paso 2 · el archivo                                                 */
  /* ------------------------------------------------------------------ */

  if (paso === "archivo") {
    return (
      <div>
        {encabezado}
        <p className="mb-4 text-base text-muted-foreground">
          {INSTRUCCIONES[entidad]}
        </p>

        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center transition-colors hover:border-brand-orange/50 hover:bg-muted/40">
          {leyendo ? (
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          ) : (
            <Upload className="h-7 w-7 text-muted-foreground" />
          )}
          <span className="text-base font-medium">
            {leyendo ? "Leyendo el archivo…" : "Elegí el archivo o arrastralo acá"}
          </span>
          <span className="text-sm text-muted-foreground">
            .csv exportado del sistema anterior · hasta 8 MB
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            disabled={leyendo}
            onChange={(e) => {
              const archivo = e.target.files?.[0];
              if (archivo) elegirArchivo(archivo);
            }}
          />
        </label>

        <p className="mt-4 text-sm text-muted-foreground">
          No hace falta que las columnas se llamen de ninguna forma en
          particular: en el paso siguiente se indica qué es cada una.
        </p>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Paso 3 · el mapeo                                                   */
  /* ------------------------------------------------------------------ */

  if (paso === "mapeo") {
    return (
      <div>
        {encabezado}

        <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-muted/40 px-4 py-3 text-base">
          <span className="flex items-center gap-2 font-medium">
            <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
            {analisis?.archivo}
          </span>
          <span className="text-muted-foreground">
            {filas.length.toLocaleString("es-AR")} filas ·{" "}
            {analisis?.columnas?.length} columnas
          </span>
          {analisis?.codificacion === "windows-1252" && (
            <span className="text-muted-foreground">
              Guardado en Windows-1252, se convirtió al leerlo.
            </span>
          )}
        </div>

        <PasoMapeo
          definicion={definicion}
          columnas={analisis?.columnas ?? []}
          primeraFila={filas[0] ?? []}
          mapeo={mapeo}
          onCambio={(clave, indice) =>
            setMapeo((previo) => ({ ...previo, [clave]: indice }))
          }
        />

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={validar} disabled={sinMapear.length > 0 || validando}>
            {validando && <Loader2 className="h-5 w-5 animate-spin" />}
            Revisar antes de migrar
          </Button>
          {sinMapear.length > 0 && (
            <p className="text-base text-brand-orange-dark">
              Falta indicar: {sinMapear.join(", ")}.
            </p>
          )}
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Paso 4 · la vista previa                                            */
  /* ------------------------------------------------------------------ */

  if (paso === "previa" && previa) {
    return (
      <div>
        {encabezado}

        <div className="grid gap-3 sm:grid-cols-3">
          <Indicador
            titulo="Entran"
            valor={previa.validas ?? 0}
            detalle="Filas que se van a escribir"
            tono="bien"
          />
          <Indicador
            titulo="Entran con reparos"
            valor={previa.conAviso ?? 0}
            detalle="Hay algo que conviene mirar después"
            tono={previa.conAviso ? "aviso" : "neutro"}
          />
          <Indicador
            titulo="Quedan afuera"
            valor={previa.conError ?? 0}
            detalle="No se pueden leer"
            tono={previa.conError ? "mal" : "neutro"}
          />
        </div>

        {(previa.muestra?.length ?? 0) > 0 && (
          <div className="mt-5 space-y-2">
            <p className="text-base font-semibold">
              Primeras filas, empezando por las que tienen problemas
            </p>
            {previa.muestra?.map((fila) => (
              <div
                key={fila.linea}
                className={`rounded-xl border bg-card p-3 ${
                  fila.errores.length > 0 ? "border-brand-orange/60" : ""
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="tabular text-sm text-muted-foreground">
                    Línea {fila.linea}
                  </span>
                  <span className="text-base font-medium">{fila.identificador}</span>
                  <span className="text-base text-muted-foreground">
                    {fila.resumen}
                  </span>
                </div>
                {fila.errores.map((error) => (
                  <p
                    key={error}
                    className="mt-1 flex items-start gap-1.5 text-sm font-medium text-brand-orange-dark"
                  >
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    {error}
                  </p>
                ))}
                {fila.avisos.map((aviso) => (
                  <p
                    key={aviso}
                    className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground"
                  >
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    {aviso}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={correr} disabled={(previa.validas ?? 0) === 0}>
            Migrar {(previa.validas ?? 0).toLocaleString("es-AR")} filas
          </Button>
          <button
            onClick={() => setPaso("mapeo")}
            className="inline-flex h-11 items-center rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted"
          >
            Corregir el mapeo
          </button>
          {(previa.rechazos?.length ?? 0) > 0 && (
            <button
              onClick={() => descargarRechazos(entidad, previa.rechazos ?? [])}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted"
            >
              <Download className="h-5 w-5" />
              Bajar las filas con problemas
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Paso 5 · corriendo                                                  */
  /* ------------------------------------------------------------------ */

  if (paso === "corriendo") {
    const porcentaje = filas.length ? Math.round((avance / filas.length) * 100) : 0;

    return (
      <div className="rounded-xl border bg-card p-6">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <Loader2 className="h-5 w-5 animate-spin text-brand-orange" />
          Migrando {definicion.titulo.toLowerCase()}…
        </p>
        <p className="mt-1 text-base text-muted-foreground">
          No cierres esta pestaña. Lo que ya entró queda guardado aunque se
          interrumpa.
        </p>

        <div
          className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={porcentaje}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Avance de la migración"
        >
          <div
            className="h-full bg-brand-orange transition-[width] duration-300"
            style={{ width: `${porcentaje}%` }}
          />
        </div>

        <p className="tabular mt-2 text-base text-muted-foreground">
          {avance.toLocaleString("es-AR")} de {filas.length.toLocaleString("es-AR")} filas ·{" "}
          {totales.creados} creados · {totales.actualizados} actualizados
          {totales.conError > 0 && ` · ${totales.conError} con problemas`}
        </p>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Paso 6 · el informe                                                 */
  /* ------------------------------------------------------------------ */

  const todoBien = controles.every((c) => c.ok) && totales.conError === 0;

  return (
    <div>
      <div
        className={`rounded-xl border p-5 ${
          todoBien ? "border-brand-green/40 bg-brand-green/5" : "border-brand-orange/50 bg-brand-orange/5"
        }`}
      >
        <p className="flex items-center gap-2 text-lg font-semibold">
          {todoBien ? (
            <CircleCheck className="h-6 w-6 text-brand-green" />
          ) : (
            <TriangleAlert className="h-6 w-6 text-brand-orange" />
          )}
          {todoBien
            ? "Migración terminada y cuadra"
            : "Migración terminada, con cosas para revisar"}
        </p>
        <p className="tabular mt-1.5 text-base">
          {totales.creados.toLocaleString("es-AR")} creados ·{" "}
          {totales.actualizados.toLocaleString("es-AR")} actualizados ·{" "}
          {totales.omitidos.toLocaleString("es-AR")} sin cambios ·{" "}
          {totales.conError.toLocaleString("es-AR")} quedaron afuera
        </p>
      </div>

      {controles.length > 0 && (
        <div className="mt-5 space-y-2">
          <p className="text-base font-semibold">Control de integridad</p>
          {controles.map((control) => (
            <div key={control.titulo} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-base font-medium">
                  {control.ok ? (
                    <CircleCheck className="mr-1.5 inline h-5 w-5 text-brand-green" />
                  ) : (
                    <CircleAlert className="mr-1.5 inline h-5 w-5 text-brand-orange" />
                  )}
                  {control.titulo}
                </p>
                <p className="tabular text-base">
                  <span className="text-muted-foreground">Archivo</span>{" "}
                  <span className="font-semibold">{control.segunElArchivo}</span>
                  <span className="mx-2 text-muted-foreground">·</span>
                  <span className="text-muted-foreground">Sistema</span>{" "}
                  <span className="font-semibold">{control.enElSistema}</span>
                </p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{control.detalle}</p>
            </div>
          ))}
        </div>
      )}

      {rechazos.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-base font-semibold">
              {rechazos.length.toLocaleString("es-AR")} filas quedaron afuera
            </p>
            <button
              onClick={() => descargarRechazos(entidad, rechazos)}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
            >
              <Download className="h-5 w-5" />
              Bajar el listado
            </button>
          </div>
          <div className="space-y-1.5">
            {rechazos.slice(0, 30).map((rechazo) => (
              <p key={`${rechazo.linea}-${rechazo.identificador}`} className="text-base">
                <span className="tabular text-sm text-muted-foreground">
                  Línea {rechazo.linea}
                </span>{" "}
                <span className="font-medium">{rechazo.identificador}</span>{" "}
                <span className="text-muted-foreground">{rechazo.motivo}</span>
              </p>
            ))}
            {rechazos.length > 30 && (
              <p className="text-sm text-muted-foreground">
                Y {rechazos.length - 30} más, en el listado que se baja.
              </p>
            )}
          </div>
        </div>
      )}

      <Button className="mt-6" onClick={volverAlPrincipio}>
        Migrar otra cosa
      </Button>
    </div>
  );
}

function Indicador({
  titulo,
  valor,
  detalle,
  tono,
}: {
  titulo: string;
  valor: number;
  detalle: string;
  tono: "bien" | "aviso" | "mal" | "neutro";
}) {
  const color = {
    bien: "text-brand-green",
    aviso: "text-brand-orange-dark",
    mal: "text-brand-orange-dark",
    neutro: "text-foreground",
  }[tono];

  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-base text-muted-foreground">{titulo}</p>
      <p className={`tabular text-3xl font-semibold ${color}`}>
        {valor.toLocaleString("es-AR")}
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground">{detalle}</p>
    </div>
  );
}
