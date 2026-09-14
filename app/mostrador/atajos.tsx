"use client";

import { Fragment, useEffect, useRef, useState } from "react";

/**
 * Los atajos del mostrador, en un solo lugar.
 *
 * La pantalla se opera de pie y con gente esperando: el foco vive en el
 * buscador y el vendedor tipea sin mirar. Por eso los atajos **andan también
 * con el foco dentro de un campo de texto** —si hubiera que salir del buscador
 * para usarlos no los usaría nadie— y por eso llevan `Alt`, que no se pisa con
 * lo que se tipea.
 *
 * La tabla es una sola: de acá salen los manejadores y también la ayuda que se
 * muestra en pantalla. Dos listas del mismo dato terminan diciendo cosas
 * distintas, como pasó con los nombres de los medios de pago.
 *
 * Se lee `event.code` y no `event.key`: con `Alt` apretado, el teclado entrega
 * el carácter alternativo —en Mac, Alt+C es «ç»— y la letra se pierde. El
 * `code` es la tecla física.
 */

export type Accion =
  | "cobrar"
  | "cliente"
  | "buscador"
  | "tipo"
  | "medio1"
  | "medio2"
  | "medio3"
  | "medio4"
  | "descuento"
  | "papel"
  | "partir"
  | "presupuesto"
  | "imprimir"
  | "caja"
  | "cantidad";

interface Definicion {
  accion: Accion;
  /** Cómo se escribe la tecla en la ayuda. */
  teclas: string;
  /** Qué hace, en la ayuda. Vacío: no se muestra (los medios van juntos). */
  texto: string;
  coincide: (e: KeyboardEvent) => boolean;
}

/** Alt y nada más: con Ctrl o Shift encima es otro atajo, no este. */
function alt(code: string) {
  return (e: KeyboardEvent) =>
    e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === code;
}

export const ATAJOS: Definicion[] = [
  {
    accion: "cobrar",
    teclas: "Ctrl + Enter",
    texto: "Cobrar",
    coincide: (e) =>
      (e.ctrlKey || e.metaKey) && !e.altKey && e.code === "Enter",
  },
  { accion: "buscador", teclas: "Alt + B", texto: "Buscar un producto", coincide: alt("KeyB") },
  { accion: "cantidad", teclas: "F2", texto: "Cambiar la cantidad del último", coincide: (e) => e.code === "F2" },
  { accion: "cliente", teclas: "Alt + C", texto: "Elegir el cliente", coincide: alt("KeyC") },
  {
    accion: "tipo",
    // Alt+T no: es el atajo con el que los avisos (`sonner`) se enfocan a sí
    // mismos, y dos cosas distintas en la misma tecla es peor que una letra
    // menos obvia.
    teclas: "Alt + O",
    texto: "Contado, cuenta corriente o acopio",
    coincide: alt("KeyO"),
  },
  { accion: "medio1", teclas: "Alt + 1", texto: "Los medios de pago, por su lugar en pantalla", coincide: alt("Digit1") },
  { accion: "medio2", teclas: "Alt + 2", texto: "", coincide: alt("Digit2") },
  { accion: "medio3", teclas: "Alt + 3", texto: "", coincide: alt("Digit3") },
  { accion: "medio4", teclas: "Alt + 4", texto: "", coincide: alt("Digit4") },
  { accion: "descuento", teclas: "Alt + D", texto: "Hacer un descuento", coincide: alt("KeyD") },
  { accion: "papel", teclas: "Alt + F", texto: "Comprobante o factura", coincide: alt("KeyF") },
  { accion: "partir", teclas: "Alt + P", texto: "Partir el pago en más de un medio", coincide: alt("KeyP") },
  { accion: "presupuesto", teclas: "Alt + U", texto: "Emitir presupuesto sin cobrar", coincide: alt("KeyU") },
  { accion: "imprimir", teclas: "Alt + I", texto: "Imprimir la última venta", coincide: alt("KeyI") },
  {
    accion: "caja",
    // K y no C: la C es del cliente, que se toca mil veces por día y se lleva
    // la inicial.
    teclas: "Alt + K",
    texto: "Abrir y cerrar el panel de caja",
    coincide: alt("KeyK"),
  },
];

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
      /*
       * Con un diálogo abierto, la pantalla de atrás no escucha.
       *
       * Pasó de verdad: `Ctrl + Enter` para cerrar el corte a medida cerró el
       * corte **y cobró la venta**, porque la tecla siguió viajando hasta acá.
       * Mientras hay algo encima, los atajos son del diálogo; el que quiera
       * uno propio se lo pone adentro.
       */
      if (hayAlgoEncima()) return;

      for (const atajo of ATAJOS) {
        if (!atajo.coincide(e)) continue;
        const hacer = caja.current[atajo.accion];
        if (!hacer) return;
        e.preventDefault();
        hacer();
        return;
      }
    }

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
  | "parte";

export function enfocar(campo: Campo, centrar = false) {
  const el = document.querySelector<HTMLElement>(`[data-foco="${campo}"]`);
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
