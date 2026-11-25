"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ATAJOS, accionDeLaTecla, type Accion } from "@/lib/mostrador/atajos";

/**
 * Los atajos del mostrador, en un solo lugar.
 *
 * La pantalla se opera de pie y con gente esperando: el foco vive en el
 * buscador y el vendedor tipea sin mirar. Por eso los atajos **andan también
 * con el foco dentro de un campo de texto** —si hubiera que salir del buscador
 * para usarlos no los usaría nadie— y por eso llevan `Alt`, que no se pisa con
 * lo que se tipea.
 *
 * La tabla es una sola (`lib/mostrador/atajos.ts`): de ahí salen los
 * manejadores y también la ayuda que se muestra en pantalla. Dos listas del
 * mismo dato terminan diciendo cosas distintas, como pasó con los nombres de
 * los medios de pago.
 */

export type { Accion } from "@/lib/mostrador/atajos";
export { ATAJOS } from "@/lib/mostrador/atajos";

/**
 * Las teclas que valen **sobre un resultado del buscador**.
 *
 * No son atajos de la pantalla —los maneja el propio buscador, porque dependen
 * de qué resultado está marcado— pero van en la misma ayuda: el vendedor no
 * distingue dónde vive cada tecla, y una que no figura no existe.
 */
export const EN_EL_BUSCADOR = [
  { teclas: "Enter", texto: "Agregar el resultado marcado" },
  { teclas: "Mayús + Enter", texto: "Media placa, partida al largo" },
  { teclas: "Alt + Enter", texto: "Media placa, partida al ancho" },
] as const;

/**
 * Si hay un diálogo abierto encima de la venta.
 *
 * El diálogo es de Base UI, que marca el abierto con `data-open` y el que se
 * está yendo con `data-closed`; se contempla también el `data-state` de Radix
 * por si el componente compartido cambia de librería. Quedarse corto acá
 * significa que una tecla del diálogo cobra la venta de atrás.
 */
function hayAlgoEncima() {
  const abiertos = document.querySelectorAll(
    '[role="dialog"], [role="alertdialog"]',
  );
  for (const el of abiertos) {
    if (el.hasAttribute("data-closed")) continue;
    if (el.getAttribute("data-state") === "closed") continue;
    return true;
  }
  return false;
}

/**
 * Engancha los atajos mientras la pantalla está montada.
 *
 * Un atajo sin manejador no hace nada **y tampoco cancela la tecla**: si todavía
 * no hay venta cargada, `Alt+I` tiene que seguir siendo del navegador y no un
 * botón muerto.
 */
export function useAtajos(manejadores: Partial<Record<Accion, () => void>>) {
  /*
   * Los manejadores se leen de una caja que se actualiza en cada render, y el
   * evento se engancha una sola vez: son funciones nuevas en cada pasada, y
   * reenganchar `keydown` por cada tecla tipeada es trabajo al pedo en la
   * pantalla que más se usa.
   */
  const caja = useRef(manejadores);
  // Se refresca después de pintar y no durante el render: entre las dos cosas
  // no puede llegar una tecla, así que el manejador nunca queda viejo.
  useEffect(() => {
    caja.current = manejadores;
  });

  useEffect(() => {
    function alApretar(e: KeyboardEvent) {
      // Qué atajo es, si es alguno: ni la tecla que un campo ya usó ni la que
      // llega con un diálogo encima (ver `accionDeLaTecla`).
      const accion = accionDeLaTecla(e, ATAJOS, hayAlgoEncima);
      if (!accion) return;
      const hacer = caja.current[accion];
      if (!hacer) return;
      e.preventDefault();
      hacer();
    }

    // En burbuja y en `window`, a propósito: llega después de los `onKeyDown`
    // de React, que es lo que hace que `defaultPrevented` sirva.
    window.addEventListener("keydown", alApretar);
    return () => window.removeEventListener("keydown", alApretar);
  }, []);
}

/* -------------------------------------------------------------------------- */

/**
 * Los campos que los atajos enfocan.
 *
 * Se los busca por `data-foco` en vez de pasar seis `ref` a través de
 * componentes que ya reciben cuarenta propiedades. El atributo queda escrito
 * al lado del campo, que es donde se lee.
 */
export type Campo =
  | "buscador"
  | "cliente"
  | "recibido"
  | "tarjeta"
  | "descuento"
  | "cantidad"
  | "parte"
  | "recibo";

/** El elemento del campo, si está en pantalla. */
export function campoEnPantalla(campo: Campo): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-foco="${campo}"]`);
}

export function enfocar(campo: Campo, centrar = false) {
  const el = campoEnPantalla(campo);
  if (!el) return;
  el.focus();
  // Lo que ya está escrito queda seleccionado: el vendedor tipea encima en vez
  // de tener que borrar primero.
  if (el instanceof HTMLInputElement) el.select();
  /*
   * `focus()` arrastra la columna solo lo justo para asomar el campo, y un
   * bloque que nace al pie —el pago partido— queda medio tapado por el total.
   * Con `centrar` se lo trae al medio y se ve entero.
   */
  if (centrar) el.scrollIntoView({ block: "center" });
}

/* -------------------------------------------------------------------------- */

/**
 * La ayuda, plegada.
 *
 * Un atajo que nadie sabe que existe no ahorra ningún clic. Las cuatro teclas
 * más usadas se ven siempre; el resto se despliega.
 */
export function AyudaDeAtajos() {
  const [abierta, setAbierta] = useState(false);
  const conTexto = ATAJOS.filter((a) => a.texto !== "");

  return (
    <div className="shrink-0 text-sm text-muted-foreground">
      <button
        type="button"
        onClick={() => setAbierta((a) => !a)}
        aria-expanded={abierta}
        className="inline-flex items-center gap-3 rounded-lg px-1.5 py-1 transition-colors hover:text-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <Tecla>Alt + C</Tecla> cliente
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Tecla>F2</Tecla> cantidad
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Tecla>Ctrl + Enter</Tecla> cobrar
        </span>
        <span className="underline underline-offset-2">
          {abierta ? "menos" : "ver todos"}
        </span>
      </button>

      {abierta && (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 rounded-xl border border-linea bg-card p-3">
          {conTexto.map((a) => (
            <Fragment key={a.accion}>
              <dt className="text-right">
                <Tecla>{a.teclas}</Tecla>
              </dt>
              <dd className="text-base">{a.texto}</dd>
            </Fragment>
          ))}
          <dt className="col-span-2 mt-1.5 border-t border-linea pt-2 text-xs font-semibold uppercase tracking-[0.08em]">
            En el buscador
          </dt>
          {EN_EL_BUSCADOR.map((a) => (
            <Fragment key={a.teclas}>
              <dt className="text-right">
                <Tecla>{a.teclas}</Tecla>
              </dt>
              <dd className="text-base">{a.texto}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

function Tecla({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-linea bg-hundida px-1.5 py-0.5 text-xs font-medium text-foreground">
      {children}
    </kbd>
  );
}
