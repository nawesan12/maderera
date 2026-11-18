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
      for (const tabla of document.querySelectorAll<HTMLTableElement>(".panel table, [data-slot=dialog-content] table")) {
        if (tabla.dataset.tabla === "fija") continue;
        const encabezados: string[] = [];
        for (const th of tabla.querySelectorAll<HTMLTableCellElement>("thead tr:last-child th")) {
          const texto = (th.textContent ?? "").trim();
          for (let i = 0; i < (th.colSpan || 1); i++) encabezados.push(texto);
        }
        if (encabezados.length === 0) continue;
        // Si no entra en su lugar, en cualquier ancho, también se apila: en
        // una tablet o con el menú abierto, una tabla de diez columnas se
        // corría de costado. Se mide el ancho que tendría sin apilar (guardado
        // la primera vez) contra el lugar que tiene.
        const lugar = tabla.parentElement?.clientWidth ?? 0;
        if (!tabla.dataset.apilada) tabla.dataset.anchoNatural = String(tabla.scrollWidth);
        const apilar = lugar > 0 && Number(tabla.dataset.anchoNatural) > lugar + 2;
        if (apilar && !tabla.dataset.apilada) tabla.dataset.apilada = "si";
        if (!apilar && tabla.dataset.apilada) delete tabla.dataset.apilada;
        for (const fila of tabla.querySelectorAll<HTMLTableRowElement>("tbody tr, tfoot tr")) {
          let col = 0;
          for (const celda of fila.cells) {
            const nombre = encabezados[col] ?? "";
            if (celda.dataset.label !== nombre) celda.dataset.label = nombre;
            col += celda.colSpan || 1;
          }
        }
      }
    };
    rotular();
    let pendiente = 0;
    const observador = new MutationObserver(() => {
      cancelAnimationFrame(pendiente);
      pendiente = requestAnimationFrame(rotular);
    });
    observador.observe(document.body, { childList: true, subtree: true });
    const alCambiarElTamano = () => {
      cancelAnimationFrame(pendiente);
      pendiente = requestAnimationFrame(rotular);
    };
    window.addEventListener("resize", alCambiarElTamano);
    return () => {
      window.removeEventListener("resize", alCambiarElTamano);
      observador.disconnect();
      cancelAnimationFrame(pendiente);
    };
  }, []);
  return null;
}
