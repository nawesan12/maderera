"use client";

import { useEffect } from "react";
import { avanzaConEnter, siguienteCampo } from "@/lib/teclado/avance";

/** Lo que puede recibir el foco dentro de un formulario, en orden de tabulación. */
const FOCUSABLES =
  "input:not([type=hidden]), select, textarea, button:not([type=button])";

/**
 * Enter pasa al campo siguiente, en todo el panel.
 *
 * **Va una sola vez, en el layout**, y no formulario por formulario. Son más de
 * veinte pantallas de carga y la regla es la misma en todas; repetirla en cada
 * una garantizaba que tres quedaran distintas. El comportamiento es el que pidió
 * la clienta: se carga un dato, Enter, el siguiente, y en el último Enter envía.
 *
 * Tres cuidados, que son los que hacen que esto no rompa nada de lo que ya
 * andaba:
 *
 * 1. **Si alguien ya atendió la tecla, no se hace nada.** El buscador de
 *    productos usa Enter para elegir de la lista, el despiece del mostrador para
 *    agregar otra medida. Todos ésos llaman a `preventDefault`, así que se los
 *    reconoce por `defaultPrevented` y se los deja pasar.
 * 2. **Solo adentro de un formulario.** Fuera de uno, Enter no tiene a dónde
 *    avanzar ni qué enviar.
 * 3. **Cada campo puede optar por salirse** con `data-enter="enviar"`.
 *
 * Los campos escondidos o deshabilitados no cuentan: avanzar a uno de ésos deja
 * el foco en la nada y parece que la tecla no hizo nada.
 */
export function EnterAvanza() {
  useEffect(() => {
    function alTeclear(evento: KeyboardEvent) {
      if (evento.key !== "Enter") return;
      if (evento.defaultPrevented) return;
      // Ctrl+Enter y compañía son atajos de envío en varias pantallas.
      if (evento.ctrlKey || evento.metaKey || evento.altKey || evento.shiftKey) {
        return;
      }

      const activo = evento.target;
      if (!(activo instanceof HTMLElement)) return;

      const campo = activo as HTMLInputElement;

      if (
        !avanzaConEnter({
          etiqueta: campo.tagName,
          tipo: campo.type,
          comportamiento: campo.dataset.enter,
        })
      ) {
        return;
      }

      const formulario = campo.closest("form");
      if (!formulario) return;

      const campos = Array.from(
        formulario.querySelectorAll<HTMLElement>(FOCUSABLES),
      ).filter(
        (el) =>
          !(el as HTMLInputElement).disabled &&
          el.getAttribute("aria-hidden") !== "true" &&
          // `offsetParent` en nulo es la forma barata de saber que no se ve.
          (el.offsetParent !== null || el === campo),
      );

      const siguiente = siguienteCampo(campos, campo);

      // En el último no se hace nada: Enter envía, que es lo que se espera
      // después de cargar el último dato.
      if (!siguiente) return;

      evento.preventDefault();
      siguiente.focus();

      // Dejar el valor seleccionado convierte "corregir" en "escribir encima",
      // que es como se carga cuando se va rápido.
      if (
        siguiente instanceof HTMLInputElement &&
        siguiente.type !== "checkbox" &&
        siguiente.type !== "radio"
      ) {
        siguiente.select?.();
      }
    }

    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, []);

  return null;
}
