"use client";

import { useId, useMemo, useState } from "react";
import { useActionState } from "react";
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  borrarPerfil,
  guardarPerfil,
  type EstadoPerfil,
} from "../perfiles-actions";
import {
  armarArchivoDeCorte,
  COLUMNAS,
  PERFIL_GENERICO,
  type ClaveColumna,
  type ColumnaConfigurada,
  type CorteParaExportar,
} from "@/lib/cortes/formatos";
import type { CuttingExportProfile } from "@/lib/db/schema";

const inicial: EstadoPerfil = {};

/** Un corte de mentira para la vista previa. Medidas reales de una placa. */
const EJEMPLO: CorteParaExportar = {
  numero: "C-1042",
  cliente: "Carpintería Pérez",
  material: "Melamina blanca 18mm",
  piezas: [
    {
      largoMm: 1229,
      anchoMm: 600,
      cantidad: 4,
      respetaVeta: 1,
      cantoLargo: 1,
      cantoAncho: 0,
      etiqueta: "Lateral",
    },
    {
      largoMm: 800,
      anchoMm: 350,
      cantidad: 2,
      respetaVeta: 0,
      cantoLargo: 0,
      cantoAncho: 1,
      etiqueta: "Estante",
    },
  ],
};

export function EditorDeFormato({ perfiles }: { perfiles: CuttingExportProfile[] }) {
  const [editando, setEditando] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {perfiles.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {perfiles.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-[12rem] flex-1">
                <p className="text-base font-medium">
                  {p.nombre}
                  {p.porDefecto && (
                    <span className="ml-2 rounded-full bg-brand-orange/12 px-2 py-0.5 text-sm font-medium text-brand-orange-dark">
                      por defecto
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {p.programa ? `Probado con ${p.programa} · ` : "Sin probar contra la máquina · "}
                  {p.unidad} · separador {p.separador === "tab" ? "tabulación" : p.separador}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setEditando(editando === p.id ? null : p.id)}
                className="h-9 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
              >
                {editando === p.id ? "Cerrar" : "Editar"}
              </button>

              <BotonBorrar id={p.id} nombre={p.nombre} />
            </li>
          ))}
        </ul>
      )}

      {perfiles.map(
        (p) => editando === p.id && <Formulario key={p.id} perfil={p} />,
      )}

      {editando !== "nuevo" ? (
        <button
          type="button"
          onClick={() => setEditando("nuevo")}
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted"
        >
          <Plus className="h-4 w-4" />
          {perfiles.length === 0 ? "Configurar un formato" : "Agregar otro formato"}
        </button>
      ) : (
        <Formulario />
      )}
    </div>
  );
}

function BotonBorrar({ id, nombre }: { id: string; nombre: string }) {
  const [, borrar] = useActionState(borrarPerfil, inicial);

  return (
    <form action={borrar}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-label={`Borrar ${nombre}`}
        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </form>
  );
}

function Formulario({ perfil }: { perfil?: CuttingExportProfile }) {
  const [estado, guardar, guardando] = useActionState(guardarPerfil, inicial);

  const [columnas, setColumnas] = useState<ColumnaConfigurada[]>(() => {
    if (!perfil) return PERFIL_GENERICO.columnas;
    try {
      const crudo = JSON.parse(perfil.columnas) as ColumnaConfigurada[];
      return Array.isArray(crudo) && crudo.length > 0 ? crudo : PERFIL_GENERICO.columnas;
    } catch {
      return PERFIL_GENERICO.columnas;
    }
  });

  const [separador, setSeparador] = useState(perfil?.separador ?? ";");
  const [unidad, setUnidad] = useState(perfil?.unidad ?? "mm");
  const [decimal, setDecimal] = useState(perfil?.decimal ?? ",");
  const [conEncabezado, setConEncabezado] = useState(perfil?.conEncabezado ?? true);
  const [valorSi, setValorSi] = useState(perfil?.valorSi ?? "Sí");
  const [valorNo, setValorNo] = useState(perfil?.valorNo ?? "No");

  // La vista previa se arma con el mismo motor que el archivo de verdad: si se
  // ve bien acá, sale así. Una previsualización aproximada no serviría para
  // esto, que es justamente acertarle a un formato ajeno.
  const previa = useMemo(
    () =>
      armarArchivoDeCorte(EJEMPLO, {
        nombre: "previa",
        separador: separador === "tab" ? "\t" : separador,
        conEncabezado,
        unidad: unidad as "mm" | "cm" | "m",
        decimal: decimal as "," | ".",
        siNo: [valorSi, valorNo],
        finDeLinea: "\n",
        columnas,
      }),
    [columnas, separador, unidad, decimal, conEncabezado, valorSi, valorNo],
  );

  const sinUsar = (Object.keys(COLUMNAS) as ClaveColumna[]).filter(
    (c) => !columnas.some((x) => x.clave === c),
  );

  function mover(indice: number, hacia: -1 | 1) {
    const destino = indice + hacia;
    if (destino < 0 || destino >= columnas.length) return;
    const copia = [...columnas];
    [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
    setColumnas(copia);
  }

  return (
    <form action={guardar} className="tarjeta space-y-5 p-5">
      {perfil && <input type="hidden" name="id" value={perfil.id} />}
      <input type="hidden" name="columnas" value={JSON.stringify(columnas)} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          nombre="nombre"
          etiqueta="Nombre"
          valorInicial={perfil?.nombre ?? ""}
          placeholder="Seccionadora del aserradero"
          requerido
        />
        <Campo
          nombre="programa"
          etiqueta="Programa del optimizador"
          valorInicial={perfil?.programa ?? ""}
          placeholder="Cut Rite, Ardis, Corte Certo…"
          ayuda="Se completa cuando se sepa cuál usan. Sirve para saber contra qué se probó."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Selector
          nombre="separador"
          etiqueta="Separador"
          valor={separador}
          alCambiar={setSeparador}
          opciones={[
            [";", "Punto y coma ( ; )"],
            [",", "Coma ( , )"],
            ["tab", "Tabulación"],
            ["|", "Barra ( | )"],
          ]}
        />
        <Selector
          nombre="unidad"
          etiqueta="Unidad"
          valor={unidad}
          alCambiar={setUnidad}
          opciones={[
            ["mm", "Milímetros"],
            ["cm", "Centímetros"],
            ["m", "Metros"],
          ]}
        />
        <Selector
          nombre="decimal"
          etiqueta="Decimal"
          valor={decimal}
          alCambiar={setDecimal}
          opciones={[
            [",", "Coma"],
            [".", "Punto"],
          ]}
        />
        <Selector
          nombre="finDeLinea"
          etiqueta="Fin de línea"
          valor={perfil?.finDeLinea ?? "crlf"}
          opciones={[
            ["crlf", "Windows (CRLF)"],
            ["lf", "Unix (LF)"],
          ]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          nombre="valorSi"
          etiqueta="Cómo se escribe «sí»"
          valorInicial={valorSi}
          alCambiar={setValorSi}
          ayuda="Para las columnas de veta y cantos. Algunos programas quieren 1 y 0."
        />
        <Campo
          nombre="valorNo"
          etiqueta="Cómo se escribe «no»"
          valorInicial={valorNo}
          alCambiar={setValorNo}
        />
      </div>

      <div>
        <p className="text-base font-medium">Columnas, en orden</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          El nombre de cada una lo decide el programa que va a importar el
          archivo, no nosotros.
        </p>

        <ul className="mt-3 space-y-2">
          {columnas.map((c, i) => (
            <li key={c.clave} className="flex flex-wrap items-center gap-2">
              <span className="w-36 shrink-0 text-base">{COLUMNAS[c.clave]}</span>
              <input
                value={c.encabezado}
                onChange={(e) => {
                  const copia = [...columnas];
                  copia[i] = { ...c, encabezado: e.target.value };
                  setColumnas(copia);
                }}
                aria-label={`Encabezado de ${COLUMNAS[c.clave]}`}
                className="h-9 min-w-[8rem] flex-1 rounded-lg border bg-background px-3 text-base"
              />
              <button
                type="button"
                onClick={() => mover(i, -1)}
                disabled={i === 0}
                aria-label="Subir"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => mover(i, 1)}
                disabled={i === columnas.length - 1}
                aria-label="Bajar"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setColumnas(columnas.filter((x) => x.clave !== c.clave))}
                aria-label={`Quitar ${COLUMNAS[c.clave]}`}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>

        {sinUsar.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {sinUsar.map((clave) => (
              <button
                key={clave}
                type="button"
                onClick={() =>
                  setColumnas([...columnas, { clave, encabezado: COLUMNAS[clave] }])
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" />
                {COLUMNAS[clave]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2.5 text-base">
          <input
            type="checkbox"
            name="conEncabezado"
            checked={conEncabezado}
            onChange={(e) => setConEncabezado(e.target.checked)}
            className="h-4 w-4 accent-brand-orange"
          />
          Poner la fila de encabezados
        </label>
        <label className="flex items-center gap-2.5 text-base">
          <input
            type="checkbox"
            name="porDefecto"
            defaultChecked={perfil?.porDefecto ?? true}
            className="h-4 w-4 accent-brand-orange"
          />
          Usar este al apretar «Para la máquina»
        </label>
      </div>

      <div>
        <p className="text-base font-medium">Así va a salir</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-sm leading-relaxed">
          {previa}
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={guardando}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </button>
        {estado.error && <p className="text-base text-destructive">{estado.error}</p>}
        {estado.ok && <p className="text-base text-muted-foreground">{estado.ok}</p>}
      </div>
    </form>
  );
}

function Campo({
  nombre,
  etiqueta,
  valorInicial,
  placeholder,
  ayuda,
  requerido = false,
  alCambiar,
}: {
  nombre: string;
  etiqueta: string;
  valorInicial: string;
  placeholder?: string;
  ayuda?: string;
  requerido?: boolean;
  alCambiar?: (valor: string) => void;
}) {
  // `useId` y no un id armado con el nombre del campo: esta pantalla dibuja un
  // formulario por cada formato guardado, así que un id fijo se repetía y el
  // navegador asociaba todas las etiquetas al primer campo con ese id. Hacer
  // clic en la etiqueta del segundo formulario enfocaba el del primero.
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-base font-medium">
        {etiqueta}
      </label>
      <input
        id={id}
        name={nombre}
        required={requerido}
        placeholder={placeholder}
        {...(alCambiar
          ? { value: valorInicial, onChange: (e) => alCambiar(e.target.value) }
          : { defaultValue: valorInicial })}
        className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
      />
      {ayuda && <p className="mt-1 text-sm text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

function Selector({
  nombre,
  etiqueta,
  valor,
  opciones,
  alCambiar,
}: {
  nombre: string;
  etiqueta: string;
  valor: string;
  opciones: [string, string][];
  alCambiar?: (valor: string) => void;
}) {
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-base font-medium">
        {etiqueta}
      </label>
      <select
        id={id}
        name={nombre}
        {...(alCambiar
          ? { value: valor, onChange: (e) => alCambiar(e.target.value) }
          : { defaultValue: valor })}
        className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
      >
        {opciones.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}
