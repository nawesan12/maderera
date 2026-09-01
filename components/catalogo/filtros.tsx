"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, SlidersHorizontal, Tag, X } from "lucide-react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export interface CategoriaFiltro {
  slug: string;
  name: string;
  productCount: number;
}

const DISPONIBILIDAD = [
  { valor: "todos", texto: "Todos los productos" },
  { valor: "en-stock", texto: "Solo con stock" },
];

const ORDEN = [
  { valor: "relevancia", texto: "Sugeridos" },
  { valor: "precio-asc", texto: "Menor precio" },
  { valor: "precio-desc", texto: "Mayor precio" },
  { valor: "nombre", texto: "Nombre" },
];

/**
 * Escribe los filtros en la URL.
 *
 * Los filtros están partidos en dos componentes —la barra de arriba y el panel
 * lateral— porque van en lugares distintos de la grilla. Un solo componente que
 * devolviera los dos dejaba que la grilla los repartiera por su cuenta, y el
 * panel de categorías terminaba ocupando la columna de los productos.
 */
function useFiltros(rutaBase = "/catalogo") {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendiente, startTransition] = useTransition();

  function actualizar(cambios: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [clave, valor] of Object.entries(cambios)) {
      if (!valor || valor === "todos" || valor === "relevancia") {
        params.delete(clave);
      } else {
        params.set(clave, valor);
      }
    }
    startTransition(() => {
      router.replace(params.size > 0 ? `${rutaBase}?${params}` : rutaBase, {
        scroll: false,
      });
    });
  }

  function limpiar() {
    startTransition(() => router.replace(rutaBase, { scroll: false }));
  }

  return { actualizar, limpiar, pendiente };
}

/** Búsqueda, orden y acceso a los filtros en pantallas chicas. */
export function BarraCatalogo({
  busquedaActual,
  ordenActual,
  children,
}: {
  busquedaActual: string;
  ordenActual: string;
  /** El panel de categorías, para mostrarlo dentro del cajón en móvil. */
  children: React.ReactNode;
}) {
  const { actualizar } = useFiltros();
  const [texto, setTexto] = useState(busquedaActual);

  useEffect(() => setTexto(busquedaActual), [busquedaActual]);

  useEffect(() => {
    if (texto === busquedaActual) return;
    const timer = setTimeout(() => actualizar({ buscar: texto }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-56 flex-1">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar en el catálogo…"
          className="h-12 rounded-[10px] border-linea bg-card pl-10 text-[15px]"
          aria-label="Buscar productos"
        />
      </div>

      <div className="flex items-center gap-2">
        <label
          htmlFor="orden"
          className="hidden text-[14.5px] text-texto-2 sm:block"
        >
          Ordenar
        </label>
        <select
          id="orden"
          value={ordenActual}
          onChange={(e) => actualizar({ orden: e.target.value })}
          className="h-12 rounded-[10px] border border-linea bg-card px-3.5 text-[15px] outline-none focus:border-accion"
        >
          {ORDEN.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.texto}
            </option>
          ))}
        </select>
      </div>

      <Sheet>
        <SheetTrigger className="inline-flex h-12 items-center justify-center gap-2 rounded-[10px] border border-linea bg-card px-4 text-[15px] font-medium lg:hidden">
          <SlidersHorizontal className="h-4 w-4" />
          Filtros
        </SheetTrigger>
        <SheetContent side="left" className="w-80 overflow-y-auto">
          <div className="mt-8 px-6 pb-8">{children}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Categorías, disponibilidad y ofertas. */
export function PanelCategorias({
  categorias,
  categoriaActual,
  stockActual,
  soloOfertas,
  cantidadOfertas,
  hayBusqueda,
}: {
  categorias: CategoriaFiltro[];
  categoriaActual: string;
  stockActual: string;
  soloOfertas: boolean;
  cantidadOfertas: number;
  hayBusqueda: boolean;
}) {
  const { actualizar, limpiar } = useFiltros();

  const hayFiltros =
    categoriaActual !== "todos" ||
    stockActual !== "todos" ||
    soloOfertas ||
    hayBusqueda;

  return (
    <nav aria-label="Filtros del catálogo">
      {cantidadOfertas > 0 && (
        <button
          onClick={() => actualizar({ ofertas: soloOfertas ? null : "1" })}
          aria-pressed={soloOfertas}
          className={`mb-[22px] flex h-12 w-full items-center gap-2.5 rounded-[11px] px-3.5 text-[15px] font-bold transition-colors ${
            soloOfertas
              ? "bg-rojo-oferta text-white"
              : "bg-[#fbe9e6] text-rojo-oferta hover:bg-[#f7dbd7] dark:bg-rojo-oferta/15 dark:hover:bg-rojo-oferta/25"
          }`}
        >
          <Tag className="h-4 w-4" />
          Ofertas
          <span className="tabular ml-auto text-[13.5px]">
            {cantidadOfertas}
          </span>
        </button>
      )}

      <h2 className="mb-2.5 text-[11.5px] font-bold uppercase tracking-[0.11em] text-texto-3">
        Categorías
      </h2>
      <ul className="space-y-0.5">
        <li>
          <button
            onClick={() => actualizar({ cat: null })}
            className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
              categoriaActual === "todos"
                ? "bg-accion font-semibold text-white"
                : "text-texto-2 hover:bg-card"
            }`}
          >
            Todo el catálogo
          </button>
        </li>
        {categorias.map((cat) => (
          <li key={cat.slug}>
            <button
              onClick={() => actualizar({ cat: cat.slug })}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                categoriaActual === cat.slug
                  ? "bg-accion font-semibold text-white"
                  : "text-texto-2 hover:bg-card"
              }`}
            >
              <span className="text-left">{cat.name}</span>
              <span
                className={`tabular text-xs ${
                  categoriaActual === cat.slug
                    ? "text-white/80"
                    : "text-texto-3"
                }`}
              >
                {cat.productCount}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <h2 className="mb-2.5 mt-[22px] text-[11.5px] font-bold uppercase tracking-[0.11em] text-texto-3">
        Disponibilidad
      </h2>
      <ul className="space-y-0.5">
        {DISPONIBILIDAD.map((d) => (
          <li key={d.valor}>
            <button
              onClick={() => actualizar({ stock: d.valor })}
              className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                stockActual === d.valor
                  ? "bg-accion font-semibold text-white"
                  : "text-texto-2 hover:bg-card"
              }`}
            >
              {d.texto}
            </button>
          </li>
        ))}
      </ul>

      {hayFiltros && (
        <button
          onClick={limpiar}
          className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-linea bg-card py-2.5 text-xs text-texto-2 transition-colors hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Limpiar filtros
        </button>
      )}

      {/* El corte a medida es lo que resuelve la búsqueda que no encontró
          nada, así que va acá y no escondido en otra página. */}
      <div className="mt-[22px] rounded-xl bg-oscuro-marca p-4 text-white">
        <p className="text-[15px] font-semibold">¿No encontrás la medida?</p>
        <p className="mt-1.5 text-[13.5px] leading-normal text-white/70">
          Lo cortamos en el aserradero. Mandanos el despiece y te cotizamos.
        </p>
        <Link
          href="/presupuesto"
          className="mt-3 flex h-[42px] items-center justify-center rounded-[9px] bg-brand-orange text-[14.5px] font-semibold text-white transition-colors hover:bg-accion-hover"
        >
          Pedir corte a medida
        </Link>
      </div>
    </nav>
  );
}
