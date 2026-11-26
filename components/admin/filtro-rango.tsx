"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarRange, X } from "lucide-react";

/**
 * Un rango de fechas libre, además de los períodos armados.
 *
 * Los presets —este mes, últimos 90 días— no contestan la pregunta que se hace
 * todos los días en el mostrador: **«¿cuánto facturamos el sábado?»**. Esto sí:
 * una fecha sola es ese día, y dos son el tramo.
 *
 * Mientras hay un rango puesto, el selector de período no manda: se dice en
 * pantalla, porque dos filtros de fecha discutiendo en silencio es cómo alguien
 * termina mirando otro mes sin darse cuenta.
 */
export function FiltroRango({
  desde,
  hasta,
}: {
  desde?: string;
  hasta?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendiente, iniciar] = useTransition();

  function cambiar(cambios: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor) params.set(clave, valor);
      else params.delete(clave);
    }

    iniciar(() =>
      router.replace(params.size > 0 ? `?${params}` : "?", { scroll: false }),
    );
  }

  const hayRango = Boolean(desde || hasta);

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-busy={pendiente}>
      <CalendarRange className="h-[18px] w-[18px] text-texto-3" aria-hidden />
      <CampoFecha etiqueta="Desde" valor={desde ?? ""} alCambiar={(v) => cambiar({ desde: v })} />
      <span className="text-sm text-texto-3">a</span>
      <CampoFecha etiqueta="Hasta" valor={hasta ?? ""} alCambiar={(v) => cambiar({ hasta: v })} />

      {hayRango && (
        <button
          type="button"
          onClick={() => cambiar({ desde: "", hasta: "" })}
          className="inline-flex h-10 items-center gap-1 rounded-lg border border-linea px-2.5 text-sm text-texto-2 transition-colors hover:bg-hundida"
        >
          <X className="h-4 w-4" />
          Quitar fechas
        </button>
      )}
    </div>
  );
}

/** aaaa-mm-dd a dd/mm/aaaa. */
function aPantalla(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** dd/mm/aaaa a aaaa-mm-dd; null si no es una fecha. */
function aIso(texto: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
  return `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Los dígitos hasta el primero que hace imposible la fecha: un día después
 * del 31 o un mes después del 12 no se llegan a escribir. Antes
 * «31/13/2026» quedaba escrito y no filtraba (simulación del mes).
 */
function sinImposibles(digitos: string): string {
  const dia = Number(digitos.slice(0, 2));
  if (digitos.length >= 2 && (dia < 1 || dia > 31)) return digitos.slice(0, 1);
  const mes = Number(digitos.slice(2, 4));
  if (digitos.length >= 4 && (mes < 1 || mes > 12)) return digitos.slice(0, 3);
  return digitos;
}

/**
 * Una fecha escrita como se escribe acá, dd/mm/aaaa.
 *
 * El `<input type="date">` la muestra en el formato del navegador: en uno en
 * inglés salía «mm/dd/yyyy» (simulación del mes, H267). Se escribe de
 * corrido —las barras se ponen solas— y se aplica al salir del campo o con
 * Enter.
 */
function CampoFecha({
  etiqueta,
  valor,
  alCambiar,
}: {
  etiqueta: string;
  valor: string;
  alCambiar: (iso: string) => void;
}) {
  const [texto, setTexto] = useState(aPantalla(valor));
  const [deAntes, setDeAntes] = useState(valor);
  // Si la URL cambió desde afuera (Quitar fechas), el campo la sigue.
  if (valor !== deAntes) {
    setDeAntes(valor);
    setTexto(aPantalla(valor));
  }
  const invalido = texto.trim() !== "" && aIso(texto) === null;
  // Se marca al salir del campo o con Enter, no mientras se escribe.
  const [marcar, setMarcar] = useState(false);

  function aplicar() {
    setMarcar(true);
    if (texto.trim() === "") {
      if (valor) alCambiar("");
      return;
    }
    const iso = aIso(texto);
    if (iso && iso !== valor) alCambiar(iso);
  }

  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">{etiqueta}</span>
      <input
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        maxLength={10}
        value={texto}
        aria-invalid={(marcar && invalido) || undefined}
        onChange={(e) => {
          setMarcar(false);
          const digitos = sinImposibles(e.target.value.replace(/\D/g, "").slice(0, 8));
          const partes = [digitos.slice(0, 2), digitos.slice(2, 4), digitos.slice(4)].filter(Boolean);
          setTexto(partes.join("/"));
        }}
        onBlur={aplicar}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // Una fecha que no existe (99/99/2026) no filtra: queda marcada y
          // seleccionada para corregirla, en vez de no pasar nada.
          aplicar();
          if (invalido) e.currentTarget.select();
        }}
        // La familia del problema va solo con la fecha marcada: también pinta
        // el texto, y puesta siempre dejaba toda fecha en rojo.
        className={`tabular h-10 w-[8.5rem] rounded-lg border border-linea bg-card px-2.5 text-[15px] outline-none transition-colors focus:border-accion/50 aria-[invalid]:border-[var(--estado-tinta)] aria-[invalid]:bg-[var(--estado-fondo)] aria-[invalid]:text-[var(--estado-tinta)] aria-[invalid]:ring-2 aria-[invalid]:ring-[var(--estado-tinta)]/30 ${
          marcar && invalido ? "estado-problema" : ""
        }`}
      />
    </label>
  );
}
