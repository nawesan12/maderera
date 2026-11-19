import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Comité final, M21: la medida va en la sans con cifras tabulares, no en la
 * mono (`.tabular`), porque a veces es una frase: «A medida — consultar»,
 * «Rojo teja». La mono queda para importes y códigos.
 */
const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

describe("las medidas del sitio", () => {
  it("la de la tarjeta va en sans", () => {
    const tarjeta = leer("components/catalogo/precio-de-tarjeta.tsx");
    const medida = tarjeta.slice(tarjeta.indexOf("function MedidaDeTarjeta"));
    expect(medida).toMatch(/<span className="flex flex-wrap gap-x-1\.5[^"]*tabular-nums/);
    expect(medida.slice(0, medida.indexOf("medida.resto > 0"))).not.toMatch(/className="tabular /);
  });

  it("las de la ficha van en sans", () => {
    const ficha = leer("components/catalogo/selector-variante.tsx");
    expect(ficha).toContain('tabular-nums">{medida.label}</p>');
    expect(ficha).not.toMatch(/className="tabular[^"-]*"[^>]*>\s*\{(v|medida)\.label\}/);
    expect(ficha).not.toContain('<p className="tabular mt-1');
  });

  it("las del armador de cortes van en sans", () => {
    const armador = leer("app/(public)/corte/vista.tsx");
    // Las medidas del armador: la de la placa y la de las tiras.
    expect(armador).not.toMatch(/className="tabular [^"]*">\s*\{(nombreDeLaMitad|piezas\[0\]\.cantidad|actual\.medida)/);
    expect(armador).toMatch(/tabular-nums text-texto-3">\s*\{nombreDeLaMitad/);
    expect(armador).toMatch(/tabular-nums text-texto-2">\s*\{piezas\[0\]\.cantidad\} tiras/);
  });

  it("el estado del canto no se sale de su columna en la planilla", () => {
    const canto = leer("components/cortes/selector-canto.tsx");
    expect(canto).toMatch(/chico \? "@2xl:hidden" : ""/);
  });
});
