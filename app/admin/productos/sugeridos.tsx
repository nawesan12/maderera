"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import Image from "next/image";
import { ImageOff, Loader2, Plus, X } from "lucide-react";
import {
  agregarSugerido,
  quitarSugerido,
  type EstadoSugeridos,
} from "./sugeridos-actions";
import type { SugeridoCargado } from "@/lib/dal/admin/products";

const inicial: EstadoSugeridos = {};

interface Candidato {
  id: string;
  nombre: string;
  categoria: string | null;
}

/**
 * Productos sugeridos de una ficha (cláusula 1.3).
 *
 * Dos listas y no una con un selector de tipo al costado, porque son dos
 * preguntas distintas: "¿qué más necesita quien compra esto?" y "¿con qué se lo
 * reemplaza?". Mezclarlas obliga a leer la etiqueta de cada renglón para saber
 * cuál es cuál.
 */
export function ProductosSugeridos({
  productId,
  cargados,
  candidatos,
}: {
  productId: string;
  cargados: SugeridoCargado[];
  candidatos: Candidato[];
}) {
  return (
    <section className="tarjeta p-5">
      <h2 className="text-lg font-medium">Productos sugeridos</h2>
      <p className="mt-1 text-base text-muted-foreground">
        Se muestran en la ficha del sitio y en el carrito. Los cargás vos porque
        el criterio no lo puede adivinar el sistema.
      </p>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <Lista
          productId={productId}
          tipo="complementario"
          titulo="También vas a necesitar"
          detalle="Lo que se lleva junto: el sellador del deck, los tornillos del machimbre."
          vacio="Sin complementos cargados, la ficha no muestra este bloque."
          cargados={cargados.filter((s) => s.tipo === "complementario")}
          candidatos={candidatos}
        />
        <Lista
          productId={productId}
          tipo="similar"
          titulo="Alternativas"
          detalle="Con qué se reemplaza cuando no convence o no hay stock."
          vacio="Sin alternativas cargadas, la ficha muestra otros productos de la misma categoría."
          cargados={cargados.filter((s) => s.tipo === "similar")}
          candidatos={candidatos}
        />
      </div>
    </section>
  );
}

function Lista({
  productId,
  tipo,
  titulo,
  detalle,
  vacio,
  cargados,
  candidatos,
}: {
  productId: string;
  tipo: "complementario" | "similar";
  titulo: string;
  detalle: string;
  vacio: string;
  cargados: SugeridoCargado[];
  candidatos: Candidato[];
}) {
  const [busqueda, setBusqueda] = useState("");
  const [elegido, setElegido] = useState<Candidato | null>(null);
  const [estado, agregar, agregando] = useActionState(agregarSugerido, inicial);
  const [, quitar] = useActionState(quitarSugerido, inicial);

  const yaCargados = useMemo(
    () => new Set(cargados.map((c) => c.relatedProductId)),
    [cargados],
  );

  // Se filtra sin acentos: nadie escribe "álamo" con tilde en un buscador.
  const coincidencias = useMemo(() => {
    const termino = normalizar(busqueda);
    if (termino.length < 2) return [];

    return candidatos
      .filter(
        (c) =>
          !yaCargados.has(c.id) &&
          (normalizar(c.nombre).includes(termino) ||
            normalizar(c.categoria ?? "").includes(termino)),
      )
      .slice(0, 8);
  }, [busqueda, candidatos, yaCargados]);

  return (
    <div>
      <h3 className="text-base font-medium">{titulo}</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">{detalle}</p>

      <ul className="mt-3 space-y-2">
        {cargados.length === 0 && (
          <li className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            {vacio}
          </li>
        )}

        {cargados.map((s) => (
          <li
            key={s.id}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
              s.activo ? "" : "opacity-60"
            }`}
          >
            <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
              {s.imagen ? (
                <Image src={s.imagen} alt="" fill className="object-cover" />
              ) : (
                <ImageOff className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground" />
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-base">{s.nombre}</span>
              <span className="block text-sm text-muted-foreground">
                {s.categoria}
                {!s.activo && " · dado de baja, no se muestra"}
              </span>
            </span>

            <form action={quitar}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="productId" value={productId} />
              <button
                type="submit"
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={`Quitar ${s.nombre}`}
              >
                <X className="h-4 w-4" />
              </button>
            </form>
          </li>
        ))}
      </ul>

      <form action={agregar} className="mt-3">
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="tipo" value={tipo} />
        <input
          type="hidden"
          name="relatedProductId"
          value={elegido?.id ?? ""}
        />

        <label htmlFor={`buscar-${tipo}`} className="sr-only">
          Buscar un producto para sugerir
        </label>
        <div className="flex gap-2">
          <input
            id={`buscar-${tipo}`}
            type="search"
            autoComplete="off"
            value={elegido ? elegido.nombre : busqueda}
            onChange={(e) => {
              setElegido(null);
              setBusqueda(e.target.value);
            }}
            placeholder="Escribí el nombre de un producto…"
            className="h-10 flex-1 rounded-lg border bg-background px-3 text-base"
          />
          <button
            type="submit"
            disabled={!elegido || agregando}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            {agregando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Agregar
          </button>
        </div>

        {!elegido && coincidencias.length > 0 && (
          <ul className="mt-2 divide-y overflow-hidden rounded-lg border">
            {coincidencias.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setElegido(c);
                    setBusqueda("");
                  }}
                  className="flex w-full items-baseline gap-2 px-3 py-2 text-left transition-colors hover:bg-muted"
                >
                  <span className="text-base">{c.nombre}</span>
                  <span className="text-sm text-muted-foreground">
                    {c.categoria}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!elegido && busqueda.trim().length >= 2 && coincidencias.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            Ningún producto activo coincide con «{busqueda.trim()}».
          </p>
        )}

        {estado.error && (
          <p className="mt-2 text-sm text-destructive">{estado.error}</p>
        )}
        {estado.ok && (
          <p className="mt-2 text-sm text-muted-foreground">{estado.ok}</p>
        )}
      </form>
    </div>
  );
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
