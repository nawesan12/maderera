"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import {
  buscarEnPanel,
  type ResultadoBusqueda,
} from "@/app/admin/buscar/actions";

/**
 * Buscador del encabezado.
 *
 * El que estaba antes era un input sin comportamiento. Este consulta de verdad y
 * lleva directo a la ficha: se abre con ⌘K desde cualquier pantalla, se recorre
 * con las flechas y se entra con Enter, para no tener que soltar el teclado
 * mientras se carga mercadería.
 */
export function BuscadorGlobal() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([]);
  /**
   * Si el panel se cerró a mano (Escape, clic afuera, o al navegar).
   *
   * El panel abierto no es estado propio: se deriva de si hay algo que buscar.
   * Guardarlo aparte obligaba a apagarlo desde un efecto cada vez que el texto
   * se acortaba, que es un `setState` sincrónico dentro de un efecto —lo que
   * React 19 marca como error— y además dejaba dos fuentes de verdad para la
   * misma pregunta.
   */
  const [cerrado, setCerrado] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const [buscando, startTransition] = useTransition();

  const hayQueBuscar = texto.trim().length >= 2;
  const abierto = hayQueBuscar && !cerrado;

  // ⌘K / Ctrl+K enfoca el buscador desde cualquier parte del panel.
  useEffect(() => {
    function atajo(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", atajo);
    return () => window.removeEventListener("keydown", atajo);
  }, []);

  // Solo dispara la búsqueda. Con menos de dos letras no hace nada: el panel
  // ya está cerrado porque `abierto` se deriva de la longitud del texto.
  useEffect(() => {
    if (texto.trim().length < 2) return;

    const timer = setTimeout(() => {
      startTransition(async () => {
        const encontrados = await buscarEnPanel(texto);
        setResultados(encontrados);
        setResaltado(0);
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [texto]);

  function ir(resultado: ResultadoBusqueda) {
    setTexto("");
    setCerrado(false);
    router.push(resultado.href);
  }

  function teclas(e: React.KeyboardEvent) {
    if (!abierto || resultados.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setResaltado((i) => (i + 1) % resultados.length);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setResaltado((i) => (i - 1 + resultados.length) % resultados.length);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      ir(resultados[resaltado]);
    }
    if (e.key === "Escape") setCerrado(true);
  }

  return (
    <div className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setCerrado(false);
        }}
        onKeyDown={teclas}
        onFocus={() => setCerrado(false)}
        // El retardo deja que el clic sobre un resultado llegue antes de que
        // el panel se cierre; sin él, el blur lo desmonta primero.
        onBlur={() => setTimeout(() => setCerrado(true), 150)}
        placeholder="Buscar productos…"
        aria-label="Buscar en el panel"
        className="h-11 w-full rounded-lg border bg-card pl-11 pr-14 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-brand-orange/50"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border px-1.5 py-0.5 text-sm text-muted-foreground sm:block">
        ⌘K
      </kbd>

      {abierto && (
        <div className="absolute left-0 right-0 top-13 z-50 overflow-hidden rounded-xl border bg-popover shadow-lg">
          {buscando && resultados.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-3 text-base text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando…
            </p>
          ) : resultados.length === 0 ? (
            <p className="px-3 py-3 text-base text-muted-foreground">
              Nada coincide con “{texto}”.
            </p>
          ) : (
            <ul role="listbox">
              {resultados.map((resultado, i) => (
                <li key={resultado.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => ir(resultado)}
                    onMouseEnter={() => setResaltado(i)}
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${
                      i === resaltado ? "bg-muted" : ""
                    }`}
                  >
                    <span className="text-base font-medium">{resultado.titulo}</span>
                    <span className="text-sm text-muted-foreground">
                      {resultado.detalle}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
