"use client";

import { Fragment, useState } from "react";
import { ChevronDown, Copy, Plus, Trash2 } from "lucide-react";
import { Confirmar } from "@/components/admin/confirmar";
import { admiteDecimales } from "@/lib/unidades";
import type { VarianteForm } from "./formulario";

export interface Atributos {
  material: string[];
  color: string[];
  terminacion: string[];
  calidad: string[];
}

/**
 * Las medidas de un producto, en grilla: una fila por medida con lo que se
 * carga siempre (código, cómo se muestra, medidas, color, precios y stock),
 * y el resto plegado debajo de cada fila.
 *
 * Antes cada medida era una tarjeta con quince campos apilados: una melamina
 * en veinte colores eran trescientos campos en una sola columna, y había que
 * bajar y bajar para comparar dos precios. En grilla se ven todas juntas, se
 * pasa de un campo al siguiente con Tab, y «Agregar medida» copia la fila
 * anterior, que casi siempre es igual salvo en una cosa.
 */
export function GrillaDeMedidas({
  variantes,
  setVariantes,
  unidad,
  nombreUnidad,
  atributos,
  campoConError,
}: {
  variantes: VarianteForm[];
  setVariantes: (f: (prev: VarianteForm[]) => VarianteForm[]) => void;
  unidad: string;
  nombreUnidad: string;
  atributos: Atributos;
  /** «variantes.2.sku»: la celda que el servidor rechazó. */
  campoConError?: string;
}) {
  const [abiertas, setAbiertas] = useState<Set<number>>(() => new Set());
  const [aQuitar, setAQuitar] = useState<number | null>(null);
  const decimales = admiteDecimales(unidad);

  function cambiar(i: number, campo: keyof VarianteForm, valor: string) {
    const numericos: (keyof VarianteForm)[] = [
      "largoMm",
      "anchoMm",
      "espesorMm",
      "stockCentral",
      "stockAserradero",
      "minCentral",
      "minAserradero",
    ];
    setVariantes((prev) =>
      prev.map((v, k) =>
        k !== i ? v : { ...v, [campo]: numericos.includes(campo) ? (valor === "" ? null : Number(valor)) : valor },
      ),
    );
  }

  /** La medida nueva copia la anterior, sin lo que identifica a una medida. */
  function agregar(desde?: number) {
    setVariantes((prev) => {
      const base = prev[desde ?? prev.length - 1];
      const nueva: VarianteForm = base
        ? { ...base, id: undefined, sku: "", label: "", codigoBarras: "", stockCentral: 0, stockAserradero: 0 }
        : vacia();
      const lista = [...prev];
      lista.splice(desde === undefined ? prev.length : desde + 1, 0, nueva);
      return lista;
    });
  }

  function quitar(i: number) {
    setVariantes((prev) => prev.filter((_, k) => k !== i));
    setAbiertas(new Set());
  }

  const error = (i: number, campo: string) => campoConError === `variantes.${i}.${campo}`;
  // Los números en cifras tabulares; el texto, en la letra de siempre, que
  // ocupa menos y entra en la celda.
  const NUMEROS = ["largoMm", "anchoMm", "espesorMm", "precioGeneral", "precioProfesional", "stockCentral", "stockAserradero",
    "minCentral", "minAserradero", "codigoBarras"];
  const celda = (i: number, campo: string, fondo = "bg-hundida") =>
    `h-10 w-full min-w-0 rounded-lg ${fondo} px-2.5 text-base outline-none focus:ring-2 focus:ring-brand-orange ${
      NUMEROS.includes(campo) ? "tabular" : ""
    } ${error(i, campo) ? "ring-2 ring-destructive" : ""}`;

  const textos: [keyof Atributos, string][] = [
    ["material", "Material"],
    ["terminacion", "Terminación"],
    ["calidad", "Tipo o calidad"],
  ];

  return (
    <div className="space-y-3">
      {(["material", "color", "terminacion", "calidad"] as const).map((a) => (
        <datalist key={a} id={`atributos-${a}`}>
          {atributos[a].map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      ))}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] table-fixed border-separate border-spacing-x-1.5 border-spacing-y-1">
          <colgroup>
            <col className="w-8" />
            <col className="w-36" />
            <col />
            <col className="w-[4.75rem]" />
            <col className="w-[4.75rem]" />
            <col className="w-[3.75rem]" />
            <col className="w-28" />
            <col className="w-28" />
            <col className="w-[4.75rem]" />
            <col className="w-[4.75rem]" />
            <col className="w-[5.25rem]" />
          </colgroup>
          <thead>
            <tr className="text-left text-sm text-muted-foreground">
              <th />
              <th className="font-medium">Código</th>
              <th className="font-medium">Cómo se muestra</th>
              <th className="font-medium">Largo</th>
              <th className="font-medium">Ancho</th>
              <th className="font-medium">Esp.</th>
              <th className="font-medium">Color</th>
              <th className="font-medium">Precio lista</th>
              <th className="font-medium leading-tight">Stock Central</th>
              <th className="font-medium leading-tight">Stock Aserr.</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {variantes.map((v, i) => {
              // La fila con el error del servidor se abre sola: el campo puede
              // estar entre los plegados.
              const abierta = abiertas.has(i) || (campoConError?.startsWith(`variantes.${i}.`) ?? false);
              const sugerido = etiquetaSugerida(v);
              return (
                <Fragment key={v.id ?? `nueva-${i}`}>
                  <tr>
                    <td>
                      <button
                        type="button"
                        aria-label={abierta ? `Plegar la medida ${i + 1}` : `Más datos de la medida ${i + 1}`}
                        aria-expanded={abierta}
                        onClick={() =>
                          setAbiertas((s) => {
                            const n = new Set(s);
                            if (n.has(i)) n.delete(i);
                            else n.add(i);
                            return n;
                          })
                        }
                        className="flex h-10 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                      >
                        <ChevronDown className={`h-5 w-5 transition-transform ${abierta ? "" : "-rotate-90"}`} />
                      </button>
                    </td>
                    <td>
                      <input
                        id={`v-${i}-sku`}
                        aria-label={`Código de la medida ${i + 1}`}
                        aria-invalid={error(i, "sku")}
                        value={v.sku}
                        onChange={(e) => cambiar(i, "sku", e.target.value)}
                        className={celda(i, "sku")}
                      />
                    </td>
                    <td>
                      <input
                        id={`v-${i}-label`}
                        aria-label={`Cómo se muestra la medida ${i + 1}`}
                        aria-invalid={error(i, "label")}
                        value={v.label}
                        placeholder={sugerido}
                        onChange={(e) => cambiar(i, "label", e.target.value)}
                        className={celda(i, "label")}
                      />
                    </td>
                    {(["largoMm", "anchoMm", "espesorMm"] as const).map((c) => (
                      <td key={c}>
                        <input
                          id={`v-${i}-${c}`}
                          aria-label={`${c === "largoMm" ? "Largo" : c === "anchoMm" ? "Ancho" : "Espesor"} en mm, medida ${i + 1}`}
                          type="number"
                          min={0}
                          value={v[c] ?? ""}
                          onChange={(e) => cambiar(i, c, e.target.value)}
                          className={celda(i, c)}
                        />
                      </td>
                    ))}
                    <td>
                      <input
                        id={`v-${i}-color`}
                        aria-label={`Color de la medida ${i + 1}`}
                        list="atributos-color"
                        value={v.color}
                        onChange={(e) => cambiar(i, "color", e.target.value)}
                        className={celda(i, "color")}
                      />
                    </td>
                    <td>
                      <input
                        id={`v-${i}-precioGeneral`}
                        aria-label={`Precio de lista, medida ${i + 1}`}
                        aria-invalid={error(i, "precioGeneral")}
                        inputMode="decimal"
                        value={v.precioGeneral === "0" ? "" : v.precioGeneral}
                        placeholder="0"
                        onChange={(e) => cambiar(i, "precioGeneral", e.target.value)}
                        className={`${celda(i, "precioGeneral")} text-right`}
                      />
                    </td>
                    {(["stockCentral", "stockAserradero"] as const).map((c) => (
                      <td key={c}>
                        <input
                          id={`v-${i}-${c}`}
                          aria-label={`${c === "stockCentral" ? "Stock en Central" : "Stock en Aserradero"}, en ${nombreUnidad}, medida ${i + 1}`}
                          type="number"
                          min={0}
                          step={decimales ? "any" : 1}
                          inputMode={decimales ? "decimal" : "numeric"}
                          value={v[c] ?? 0}
                          onChange={(e) => cambiar(i, c, e.target.value)}
                          className={`${celda(i, c)} text-right`}
                        />
                      </td>
                    ))}
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          aria-label={`Copiar la medida ${i + 1}`}
                          title="Copiar esta medida"
                          onClick={() => agregar(i)}
                          className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        {variantes.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Quitar la medida ${i + 1}`}
                            onClick={() => (v.id ? setAQuitar(i) : quitar(i))}
                            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {abierta && (
                    <tr>
                      <td />
                      <td colSpan={10} className="pb-3">
                        <div className="tarjeta-hundida grid gap-3 rounded-xl p-3 sm:grid-cols-4 xl:grid-cols-7">
                          {textos.map(([c, etiqueta]) => (
                            <label key={c} className="space-y-1 text-sm text-muted-foreground">
                              {etiqueta}
                              <input
                                id={`v-${i}-${c}`}
                                list={`atributos-${c}`}
                                value={v[c]}
                                onChange={(e) => cambiar(i, c, e.target.value)}
                                className={`${celda(i, c, "bg-card shadow-sm")} text-foreground`}
                              />
                            </label>
                          ))}
                          <label className="space-y-1 text-sm text-muted-foreground">
                            Precio profesional
                            <input
                              id={`v-${i}-precioProfesional`}
                              inputMode="decimal"
                              value={v.precioProfesional === "0" ? "" : v.precioProfesional}
                              placeholder="por lista"
                              onChange={(e) => cambiar(i, "precioProfesional", e.target.value)}
                              className={`${celda(i, "precioProfesional", "bg-card shadow-sm")} text-right text-foreground`}
                            />
                          </label>
                          <label className="space-y-1 text-sm text-muted-foreground">
                            Código de barras
                            <input
                              id={`v-${i}-codigoBarras`}
                              inputMode="numeric"
                              value={v.codigoBarras}
                              onChange={(e) => cambiar(i, "codigoBarras", e.target.value)}
                              className={`${celda(i, "codigoBarras", "bg-card shadow-sm")} text-foreground`}
                            />
                          </label>
                          {(["minCentral", "minAserradero"] as const).map((c) => (
                            <label key={c} className="space-y-1 text-sm text-muted-foreground">
                              {c === "minCentral" ? "Mínimo Central" : "Mínimo Aserradero"}
                              <input
                                id={`v-${i}-${c}`}
                                type="number"
                                min={0}
                                step={decimales ? "any" : 1}
                                value={v[c] ?? 0}
                                onChange={(e) => cambiar(i, c, e.target.value)}
                                className={`${celda(i, c, "bg-card shadow-sm")} text-right text-foreground`}
                              />
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => agregar()}
        className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-hundida px-4 text-base font-medium hover:bg-muted"
      >
        <Plus className="h-5 w-5" />
        Agregar medida
      </button>
      <p className="text-sm text-muted-foreground">Precios finales, con IVA. Stock en {nombreUnidad}.</p>

      <Confirmar
        abierto={aQuitar !== null}
        alCerrar={() => setAQuitar(null)}
        titulo={`Quitar la medida ${aQuitar !== null ? variantes[aQuitar]?.label || aQuitar + 1 : ""}`}
        detalle="Al guardar, la medida sale del catálogo con su precio y su stock."
        confirmar="Quitar la medida"
        peligro
        alConfirmar={() => {
          const i = aQuitar;
          setAQuitar(null);
          if (i !== null) quitar(i);
        }}
      />
    </div>
  );
}

export function vacia(): VarianteForm {
  return {
    sku: "",
    label: "",
    largoMm: null,
    anchoMm: null,
    espesorMm: null,
    material: "",
    color: "",
    terminacion: "",
    calidad: "",
    codigoBarras: "",
    precioGeneral: "0",
    precioProfesional: "",
    stockCentral: 0,
    stockAserradero: 0,
    minCentral: 0,
    minAserradero: 0,
  };
}

/**
 * Cómo se muestra la medida si nadie lo escribe: «1830 x 2600 — 18 mm Blanco».
 * Sale de las medidas y el color, que ya están cargados en la misma fila.
 */
export function etiquetaSugerida(v: VarianteForm): string {
  const plano = [v.largoMm, v.anchoMm].filter((n) => n && n > 0).join(" x ");
  const partes = [plano, v.espesorMm ? `${v.espesorMm} mm` : "", v.color.trim()].filter(Boolean);
  if (plano && partes.length > 1) return `${plano} — ${partes.slice(1).join(" ")}`;
  return partes.join(" ");
}
