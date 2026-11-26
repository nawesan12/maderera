"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search, UserRound, X } from "lucide-react";
import { buscarClientes } from "@/app/mostrador/actions";
import { camposDelFormulario, enfocarCampo } from "@/components/admin/enter-avanza";
import { enterEnBuscador } from "@/lib/teclado/avance";

export interface ClienteElegido {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
}

/**
 * Elegir un cliente escribiendo, contra el servidor.
 *
 * Antes cada pantalla que pedía un cliente se bajaba la cartera entera para
 * un desplegable o un filtro local: con el padrón de ISIS eran miles de
 * nombres por carga, y ahora la cartera viene de a páginas. Acá se busca
 * mientras se escribe, con la misma búsqueda del mostrador (nombre, razón
 * social, CUIT o teléfono).
 *
 * Los resultados se guardan con la consulta que los trajo: si la consulta
 * cambió mientras se esperaba, no se muestran los de la anterior.
 *
 * Teclado: flechas para moverse, Enter para elegir, Escape para borrar. Un
 * Enter que llega antes que los resultados elige el primero cuando lleguen
 * (ver `enterEnBuscador`), y después de elegir el foco pasa al campo
 * siguiente del formulario: la cadena «Enter, el siguiente» no se corta acá.
 * Con `nombre`, el id elegido va en un campo oculto para los formularios que
 * se mandan con FormData.
 */
export function ElegirCliente({
  elegido,
  onElegir,
  nombre,
  etiqueta = "Cliente",
  chico = false,
}: {
  elegido: ClienteElegido | null;
  onElegir: (c: ClienteElegido | null) => void;
  nombre?: string;
  etiqueta?: string;
  /** Para los formularios de etiquetas chicas y campos de 40 px. */
  chico?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [traidos, setTraidos] = useState<{
    clave: string;
    items: ClienteElegido[];
    fallo: boolean;
  }>({ clave: "", items: [], fallo: false });
  const [activo, setActivo] = useState(0);
  const [reintento, setReintento] = useState(0);
  const consulta = texto.trim();
  const vigentes = traidos.clave === consulta;
  const resultados = vigentes ? traidos.items : [];
  const fallo = vigentes && traidos.fallo;
  const buscando = consulta.length >= 2 && !vigentes;
  const id = useId();
  const contenedor = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const cambiar = useRef<HTMLButtonElement>(null);
  // La consulta en la que se apretó Enter antes de tener resultados.
  const alLlegar = useRef<string | null>(null);
  // A dónde va el foco después de elegir o de apretar «Cambiar».
  const foco = useRef<"siguiente" | "buscador" | null>(null);
  const claseEtiqueta = chico
    ? "mb-1 block text-sm font-medium"
    : "mb-1 block text-base font-medium";
  const alto = chico ? "min-h-10" : "min-h-11";

  useEffect(() => {
    if (consulta.length < 2) return;
    let vigente = true;
    const espera = setTimeout(async () => {
      try {
        const encontrados = await buscarClientes(consulta);
        if (vigente) {
          setTraidos({ clave: consulta, items: encontrados, fallo: false });
          setActivo(0);
          if (alLlegar.current === consulta) {
            alLlegar.current = null;
            if (encontrados[0]) elegir(encontrados[0]);
          }
        }
      } catch {
        if (vigente) setTraidos({ clave: consulta, items: [], fallo: true });
        if (alLlegar.current === consulta) alLlegar.current = null;
      }
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(espera);
    };
    // `elegir` cambia en cada render y no cambia lo que se busca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta, reintento]);

  function elegir(c: ClienteElegido | null) {
    foco.current = c ? "siguiente" : "buscador";
    onElegir(c);
    setTexto("");
  }

  // Al elegir, el buscador se desmonta y el foco quedaba en la nada: el
  // Enter siguiente no hacía nada y había que ir al mouse. Va al campo que
  // sigue en el formulario o, si no hay, a «Cambiar». Al apretar «Cambiar»,
  // vuelve al buscador.
  useEffect(() => {
    const destino = foco.current;
    foco.current = null;
    if (destino === "buscador" && !elegido) {
      campo.current?.focus();
      return;
    }
    if (destino !== "siguiente" || !elegido || !contenedor.current) return;
    const propio = contenedor.current;
    const formulario = propio.closest("form");
    const siguiente = formulario
      ? camposDelFormulario(formulario).find(
          (el) =>
            !propio.contains(el) &&
            Boolean(propio.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
        )
      : undefined;
    if (siguiente) enfocarCampo(siguiente);
    else cambiar.current?.focus();
  }, [elegido]);

  const oculto = nombre ? (
    <input type="hidden" name={nombre} value={elegido?.id ?? ""} />
  ) : null;

  if (elegido) {
    return (
      <div ref={contenedor}>
        <span className={claseEtiqueta}>{etiqueta}</span>
        {oculto}
        <div className={`tarjeta-hundida flex ${alto} items-center gap-3 px-4 py-1.5`}>
          <UserRound className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-base font-medium">
            {/* El nombre, como la ficha y la lista de clientes; la razón
                social va en la lista de resultados, debajo (mes simulado). */}
            {elegido.nombre || elegido.razonSocial}
            {elegido.cuit && (
              <span className="tabular ml-2 font-normal text-muted-foreground">
                {elegido.cuit}
              </span>
            )}
          </span>
          <button
            ref={cambiar}
            type="button"
            onClick={() => elegir(null)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-base font-medium transition-colors hover:bg-background"
          >
            <X className="h-4 w-4" />
            Cambiar
          </button>
        </div>
      </div>
    );
  }

  const abierto = consulta.length >= 2;
  const lista = `${id}-lista`;
  const opcion = (i: number) => `${id}-opcion-${i}`;

  return (
    <div ref={contenedor}>
      <label htmlFor={id} className={claseEtiqueta}>
        {etiqueta}
      </label>
      {oculto}
      <div className="relative">
        {buscando ? (
          <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        )}
        <input
          ref={campo}
          id={id}
          role="combobox"
          aria-expanded={abierto && resultados.length > 0}
          aria-controls={lista}
          aria-autocomplete="list"
          aria-activedescendant={
            resultados.length > 0 ? opcion(activo) : undefined
          }
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && resultados.length > 0) {
              e.preventDefault();
              setActivo((a) => (a + 1) % resultados.length);
            } else if (e.key === "ArrowUp" && resultados.length > 0) {
              e.preventDefault();
              setActivo((a) => (a - 1 + resultados.length) % resultados.length);
            } else if (e.key === "Enter") {
              const accion = enterEnBuscador({
                texto,
                buscando,
                hayMarcado: Boolean(resultados[activo]),
              });
              // Lo que no sea «seguir» se queda acá: sin el preventDefault,
              // el avance del panel (EnterAvanza) se llevaba el foco.
              if (accion !== "seguir") e.preventDefault();
              if (accion === "elegir") elegir(resultados[activo]);
              if (accion === "al-llegar") alLlegar.current = consulta;
            } else if (e.key === "Escape" && texto) {
              e.preventDefault();
              setTexto("");
            }
          }}
          placeholder="Nombre, razón social o CUIT"
          autoComplete="off"
          className={`${chico ? "h-10" : "h-11"} w-full rounded-lg border bg-background pl-9 pr-3 text-base`}
        />
      </div>
      {abierto && (
        <ul id={lista} role="listbox" className="tarjeta mt-1.5 max-h-72 overflow-y-auto">
          {buscando && resultados.length === 0 && (
            <li className="px-3.5 py-2.5 text-base text-muted-foreground">
              Buscando…
            </li>
          )}
          {fallo && (
            <li className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-base">
              <span className="text-destructive">No se pudo buscar.</span>
              <button
                type="button"
                onClick={() => {
                  setTraidos({ clave: "", items: [], fallo: false });
                  setReintento((n) => n + 1);
                }}
                className="font-medium underline-offset-4 hover:underline"
              >
                Reintentar
              </button>
            </li>
          )}
          {!buscando && !fallo && resultados.length === 0 && (
            <li className="px-3.5 py-2.5 text-base text-muted-foreground">
              Ninguno con ese nombre.
            </li>
          )}
          {resultados.map((c, i) => (
            <li
              key={c.id}
              id={opcion(i)}
              role="option"
              aria-selected={i === activo}
            >
              <button
                type="button"
                tabIndex={-1}
                onMouseEnter={() => setActivo(i)}
                onClick={() => elegir(c)}
                className={`flex w-full flex-col items-start px-3.5 py-2.5 text-left transition-colors ${
                  i === activo ? "bg-hundida" : "hover:bg-hundida"
                }`}
              >
                <span className="text-base font-medium">
                  {c.nombre || c.razonSocial}
                </span>
                {(c.cuit || (c.razonSocial && c.razonSocial !== c.nombre)) && (
                  <span className="tabular text-base text-muted-foreground">
                    {[c.razonSocial && c.razonSocial !== c.nombre ? c.razonSocial : null, c.cuit]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
