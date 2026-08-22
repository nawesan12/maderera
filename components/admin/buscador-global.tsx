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
  const [abierto, setAbierto] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const [buscando, startTransition] = useTransition();

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

  useEffect(() => {
    if (texto.trim().length < 2) {
      setResultados([]);
      setAbierto(false);
      return;
    }
    const timer = setTimeout(() => {
      startTransition(async () => {
        const encontrados = await buscarEnPanel(texto);
        setResultados(encontrados);
        setResaltado(0);
        setAbierto(true);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [texto]);

  function ir(resultado: ResultadoBusqueda) {
    setAbierto(false);
    setTexto("");
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
    if (e.key === "Escape") setAbierto(false);
  }

  return (
    <div className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={teclas}
        onFocus={() => resultados.length > 0 && setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
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
