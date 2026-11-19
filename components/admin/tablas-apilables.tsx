"use client";

import { useEffect } from "react";

/**
 * Las tablas del panel, apiladas en el teléfono.
 *
 * En una pantalla de 390 px una tabla de seis columnas o se sale de costado o
 * se lee con lupa (Nahuel: «está horrible la UI en celular de todo el
 * admin»). Debajo de 640 px cada fila pasa a ser una tarjeta con «Columna:
 * valor» (el CSS está en `globals.css`, bajo `.panel table`). Para eso cada
 * celda necesita saber el nombre de su columna: este componente se lo copia
 * del encabezado como `data-label`, en todas las tablas del panel y en las que
 * aparezcan después (listas que se filtran, diálogos), sin tocar las treinta
 * tablas una por una. Una tabla que no tiene que apilarse lleva
 * `data-tabla="fija"`.
 */
export function TablasApilables() {
  useEffect(() => {
    const rotular = () => {
      const tablas = [
        ...document.querySelectorAll<HTMLTableElement>(".panel table, [data-slot=dialog-content] table"),
      ].filter((t) => t.dataset.tabla !== "fija");
      // Primero todas las medidas y después todas las escrituras: leer el
      // ancho después de escribir un atributo obliga al navegador a
      // recalcular el diseño, una vez por tabla.
      const medidas = tablas.map((tabla) => ({
        tabla,
        natural: tabla.dataset.apilada ? Number(tabla.dataset.anchoNatural) : tabla.scrollWidth,
        lugar: tabla.parentElement?.clientWidth ?? 0,
      }));
      for (const { tabla, natural, lugar } of medidas) {
        const encabezados: string[] = [];
        for (const th of tabla.querySelectorAll<HTMLTableCellElement>("thead tr:last-child th")) {
          const texto = (th.textContent ?? "").trim();
          for (let i = 0; i < (th.colSpan || 1); i++) encabezados.push(texto);
        }
        if (encabezados.length === 0) continue;
        // Si no entra en su lugar, en cualquier ancho, también se apila: en
        // una tablet o con el menú abierto, una tabla de diez columnas se
        // corría de costado. Se compara el ancho que tendría sin apilar
        // (guardado la primera vez) con el lugar que tiene.
        if (!tabla.dataset.apilada) tabla.dataset.anchoNatural = String(natural);
        const apilar = lugar > 0 && natural > lugar + 2;
        if (apilar && !tabla.dataset.apilada) tabla.dataset.apilada = "si";
        if (!apilar && tabla.dataset.apilada) delete tabla.dataset.apilada;
        for (const fila of tabla.querySelectorAll<HTMLTableRowElement>("tbody tr, tfoot tr")) {
          let col = 0;
          for (const celda of fila.cells) {
            // La que abarca varias columnas va entera y sin etiqueta: el
            // nombre de la primera no la describe.
            const nombre = (celda.colSpan || 1) > 1 ? "" : (encabezados[col] ?? "");
            if (celda.dataset.label !== nombre) celda.dataset.label = nombre;
            col += celda.colSpan || 1;
          }
        }
      }
    };
    const { programar, cancelar } = rotularAgrupado(window, rotular);
    programar();
    const observador = new MutationObserver(programar);
    observador.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", programar);
    return () => {
      window.removeEventListener("resize", programar);
      observador.disconnect();
      cancelar();
    };
  }, []);
  return null;
}

/**
 * Junta los pedidos de rotular en una sola espera.
 *
 * Si ya hay una en marcha, el pedido nuevo no la reinicia: la espera que
 * está corre igual y rotula lo que haya en ese momento. Antes cada cambio
 * cancelaba y arrancaba otra, y en una pantalla que se refresca en vivo (el
 * tablero) o con un buscador que redibuja en cada tecla el plazo volvía a
 * cero sin parar: la tabla apilada en el celular quedaba sin nombres en las
 * celdas (revisión del comité).
 */
export function rotularAgrupado(ventana: VentanaQuieta, fn: () => void): { programar: () => void; cancelar: () => void } {
  let cancelarEspera: (() => void) | null = null;
  return {
    programar() {
      if (cancelarEspera) return;
      cancelarEspera = cuandoEsteQuieto(ventana, () => {
        cancelarEspera = null;
        fn();
      });
    },
    cancelar() {
      cancelarEspera?.();
      cancelarEspera = null;
    },
  };
}

/** Lo que `cuandoEsteQuieto` usa de `window`: así se prueba sin navegador. */
export interface VentanaQuieta {
  document: { readyState: string };
  addEventListener(tipo: "load", fn: () => void, opciones?: { once?: boolean }): void;
  removeEventListener(tipo: "load", fn: () => void): void;
  requestIdleCallback?: (fn: () => void, opciones?: { timeout?: number }) => number;
  cancelIdleCallback?: (id: number) => void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/**
 * Corre `fn` cuando la página terminó de cargar y React no tiene nada
 * pendiente, y devuelve con qué cancelarlo.
 *
 * Por qué no enseguida (comité final): el efecto de este componente corre
 * apenas él se hidrata, pero las partes de la página que llegan después
 * —cada Suspense que se transmite— todavía no. Escribir `data-label` sobre
 * ese HTML antes de que React lo hidrate es una diferencia entre el servidor
 * y el cliente, y salían los avisos de hidratación en ocho pantallas. El
 * MutationObserver lo empeoraba: se dispara justo cuando llega el HTML
 * nuevo, antes de hidratarlo. `requestIdleCallback` espera a que el hilo
 * esté libre, y la hidratación son tareas que lo ocupan.
 */
export function cuandoEsteQuieto(ventana: VentanaQuieta, fn: () => void): () => void {
  let id: number | null = null;
  let cancelado = false;
  const enReposo = () => {
    if (cancelado) return;
    if (ventana.requestIdleCallback) {
      id = ventana.requestIdleCallback(fn, { timeout: 1000 });
    } else {
      id = ventana.setTimeout(fn, 150);
    }
  };
  if (ventana.document.readyState === "complete") enReposo();
  else ventana.addEventListener("load", enReposo, { once: true });
  return () => {
    cancelado = true;
    ventana.removeEventListener("load", enReposo);
    if (id === null) return;
    if (ventana.requestIdleCallback && ventana.cancelIdleCallback) ventana.cancelIdleCallback(id);
    else ventana.clearTimeout(id);
  };
}
