"use client";

import { useEffect, useState } from "react";
import { Plus, Printer, X } from "lucide-react";
import { BotonesDeFiltro, CampoDeBusqueda } from "@/components/admin/filtros-de-lista";
import {
  escribirPedidoDeEtiquetas,
  TOPE_DE_ETIQUETAS,
  TOPE_DE_MEDIDAS,
  TOPE_POR_MEDIDA,
  type FormatoDeEtiqueta,
} from "@/lib/etiquetas-de-medidas";
import { buscarMedidas, type MedidaEncontrada } from "../actions";

export interface MedidaElegida {
  id: string;
  producto: string;
  medida: string;
  codigo: string;
  cantidad: number;
}

/**
 * Armar la tanda de etiquetas. La búsqueda la hace Go (con miles de medidas
 * no se manda el catálogo al navegador) y la hoja se abre en otra pestaña con
 * todo en la URL: se puede recargar o volver a imprimir sin guardar nada.
 */
export function ArmadorDeEtiquetas({
  iniciales,
  conPrecioPorOmision,
}: {
  iniciales: MedidaElegida[];
  conPrecioPorOmision: boolean;
}) {
  const [elegidas, setElegidas] = useState<MedidaElegida[]>(iniciales);
  const [formato, setFormato] = useState<FormatoDeEtiqueta>("a4");
  const [conPrecio, setConPrecio] = useState(conPrecioPorOmision);
  const [texto, setTexto] = useState("");
  const [encontradas, setEncontradas] = useState<MedidaEncontrada[]>([]);

  // Una consulta por pausa, no por tecla; la respuesta vieja no pisa a la nueva.
  useEffect(() => {
    const t = texto.trim();
    if (t.length < 2) return;
    let vigente = true;
    const reloj = setTimeout(() => {
      buscarMedidas(t).then((r) => {
        if (vigente) setEncontradas(r);
      });
    }, 300);
    return () => {
      vigente = false;
      clearTimeout(reloj);
    };
  }, [texto]);

  const resultados = texto.trim().length >= 2 ? encontradas.filter((e) => !elegidas.some((x) => x.id === e.id)) : [];

  function agregar(medidas: MedidaEncontrada[]) {
    setElegidas((prev) => [
      ...prev,
      ...medidas
        .filter((m) => !prev.some((p) => p.id === m.id))
        .map((m) => ({ id: m.id, producto: m.producto, medida: m.medida, codigo: m.codigo, cantidad: 1 })),
    ]);
  }

  function cambiarCantidad(id: string, valor: string) {
    const n = Math.min(Math.max(Math.floor(Number(valor)) || 0, 0), TOPE_POR_MEDIDA);
    setElegidas((prev) => prev.map((e) => (e.id === id ? { ...e, cantidad: n } : e)));
  }

  const total = elegidas.reduce((s, e) => s + e.cantidad, 0);
  const consulta = new URLSearchParams({
    m: escribirPedidoDeEtiquetas(elegidas),
    formato,
    ...(conPrecio ? { precio: "1" } : {}),
  });
  const medidas = elegidas.filter((e) => e.cantidad > 0).length;
  // Los dos topes de la hoja: con más, la impresión saldría recortada o con
  // error, así que se avisa acá y no se ofrece imprimir.
  const demasiadas =
    medidas > TOPE_DE_MEDIDAS
      ? `Son más de ${TOPE_DE_MEDIDAS} medidas: imprimilas en dos tandas.`
      : total > TOPE_DE_ETIQUETAS
        ? `Son más de ${TOPE_DE_ETIQUETAS} etiquetas: imprimilas en dos tandas.`
        : null;
  const imprimible = total > 0 && !demasiadas;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="space-y-4">
        <CampoDeBusqueda
          valor={texto}
          alEscribir={setTexto}
          placeholder="Nombre, medida o código"
          etiqueta="Buscar medidas"
        />
        {resultados.length > 0 && (
          <div className="tarjeta overflow-hidden">
            <ul>
              {resultados.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => agregar([r])}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-base hover:bg-muted"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.producto}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {r.medida} · <span className="tabular">{r.sku}</span>
                      </span>
                    </span>
                    <Plus className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            {resultados.length > 1 && (
              <button
                type="button"
                onClick={() => agregar(resultados)}
                className="flex h-11 w-full items-center justify-center gap-1.5 bg-hundida text-base font-medium hover:text-acento-texto"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
                Agregar las {resultados.length}
              </button>
            )}
          </div>
        )}

        {elegidas.length > 0 && (
          <ul className="space-y-2">
            {elegidas.map((e) => (
              <li key={e.id} className="tarjeta flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium">{e.producto}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {e.medida} · <span className="tabular">{e.codigo}</span>
                  </p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={TOPE_POR_MEDIDA}
                  value={e.cantidad}
                  onChange={(ev) => cambiarCantidad(e.id, ev.target.value)}
                  aria-label={`Etiquetas de ${e.producto} ${e.medida}`}
                  className="tabular h-11 w-20 rounded-lg bg-hundida px-3 text-right text-lg font-semibold outline-none focus:ring-2 focus:ring-brand-orange"
                />
                <button
                  type="button"
                  onClick={() => setElegidas((prev) => prev.filter((x) => x.id !== e.id))}
                  aria-label={`Quitar ${e.producto} ${e.medida}`}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <X className="h-5 w-5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside className="tarjeta space-y-5 p-5 xl:sticky xl:top-24">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Formato</p>
          <BotonesDeFiltro
            etiqueta="Formato"
            actual={formato}
            alElegir={(v) => setFormato(v === "rollo" ? "rollo" : "a4")}
            opciones={[
              { valor: "a4", texto: "A4 · 21 por hoja" },
              { valor: "rollo", texto: "Rollo 50 × 25" },
            ]}
          />
        </div>
        <label className="flex items-center gap-3 text-base">
          <input
            type="checkbox"
            checked={conPrecio}
            onChange={(e) => setConPrecio(e.target.checked)}
            className="h-5 w-5 accent-[var(--color-accion,currentColor)]"
          />
          Con precio
        </label>
        {demasiadas && (
          <p role="alert" className="estado-espera rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-base">
            {demasiadas}
          </p>
        )}
        {imprimible ? (
          <a
            href={`/etiquetas-de-medidas?${consulta}`}
            target="_blank"
            rel="noopener noreferrer"
            className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg text-lg font-semibold"
          >
            <Printer className="h-5 w-5" aria-hidden="true" />
            Imprimir {total === 1 ? "1 etiqueta" : `${total} etiquetas`}
          </a>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-hundida text-lg font-semibold text-muted-foreground"
          >
            <Printer className="h-5 w-5" aria-hidden="true" />
            Imprimir
          </span>
        )}
      </aside>
    </div>
  );
}
