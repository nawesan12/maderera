import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * En el teléfono las tablas se apilan por la media query de 640 px, no por
 * `data-apilada`: `tablas-apilables.tsx` mide la tabla ya apilada, ve que
 * entra y no la marca. El arreglo de «PED-1086» partido en «PED-» / «1086»
 * se había puesto solo en `table[data-apilada]`, y al teléfono no llegaba.
 * Sin navegador acá, se mira el CSS: las dos maneras de apilar tienen que
 * decir lo mismo.
 */
const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

function bloqueDelTelefono(): string {
  const inicio = css.indexOf('@media (max-width: 639px) {\n  :is(.panel, [data-slot="dialog-content"]) table:not([data-tabla="fija"])');
  expect(inicio).toBeGreaterThan(-1);
  // Hasta la llave que cierra la media query.
  let nivel = 0;
  for (let i = css.indexOf("{", inicio); i < css.length; i++) {
    if (css[i] === "{") nivel++;
    if (css[i] === "}" && --nivel === 0) return css.slice(inicio, i + 1);
  }
  throw new Error("media query sin cerrar");
}

describe("las tablas apiladas en el teléfono", () => {
  const bloque = bloqueDelTelefono();

  it("no parten una palabra que entra sola en el renglón", () => {
    expect(bloque).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(bloque).toMatch(/overflow-wrap:\s*break-word/);
  });

  it("no parten los números ni los códigos", () => {
    expect(bloque).toMatch(/> :is\(\.tabular, \.codigo\)[\s\S]*?white-space: nowrap !important/);
  });

  it("el rótulo se encoge con puntos suspensivos", () => {
    const antes = bloque.slice(bloque.indexOf("::before"));
    expect(antes).toMatch(/flex-shrink: 1/);
    expect(antes).toMatch(/text-overflow: ellipsis/);
  });

  it("la regla que deja bajar el texto no le gana al código", () => {
    expect(css).toMatch(/:not\(\.tabular, \.codigo, \.whitespace-nowrap/);
  });
});
