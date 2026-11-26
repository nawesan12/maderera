import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seOfreceLaFirma } from "@/lib/entregas/firma";

/** Comité final, M17: el link de firma y las acciones del remito. */
describe("el link de firma del remito", () => {
  it("se ofrece solo si el remito está vigente y sin firmar", () => {
    expect(seOfreceLaFirma({ estado: "preparada", firmaToken: "t", firmadoAt: null })).toBe(true);
    expect(seOfreceLaFirma({ estado: "anulada", firmaToken: "t", firmadoAt: null })).toBe(false);
    expect(seOfreceLaFirma({ estado: "entregada", firmaToken: "t", firmadoAt: new Date() })).toBe(false);
    expect(seOfreceLaFirma({ estado: "preparada", firmaToken: null, firmadoAt: null })).toBe(false);
  });

  it("las acciones bajan de renglón en el teléfono", () => {
    const vista = readFileSync(join(__dirname, "..", "app", "admin", "pedidos", "[id]", "entregas.tsx"), "utf8");
    expect(vista).toContain('<div className="flex flex-wrap items-center gap-2">');
    expect(vista).not.toMatch(/\{remito\.firmaToken && \(/);
  });
});

/** Comité final, M16: el encabezado de /taller no se corre de costado. */
describe("el encabezado del taller", () => {
  const pagina = readFileSync(join(__dirname, "..", "app", "taller", "page.tsx"), "utf8");
  it("el nombre se esconde en el teléfono y se recorta", () => {
    expect(pagina).toMatch(/className="hidden min-w-0 [^"]*truncate[^"]*(?:sm|md|lg|xl):block"[^>]*>\{usuario\.name\}/);
  });
  // El formato del archivo salió del encabezado (mes simulado, H231 y H120):
  // la ayuda y la vuelta al panel quedan como íconos hasta que hay lugar.
  it("sin el formato del archivo, y ayuda y panel como íconos en el teléfono", () => {
    expect(pagina).not.toContain("/admin/cortes/formato");
    expect(pagina.match(/<span className="hidden whitespace-nowrap xl:inline">/g)).toHaveLength(2);
    expect(pagina).toContain('aria-label="Cómo se usa"');
  });
  it("las acciones van a la derecha también en el teléfono", () => {
    // El que lleva ml-auto tiene que verse siempre: nada de hidden.
    const conMlAuto = [...pagina.matchAll(/className="([^"]*\bml-auto\b[^"]*)"/g)].map((m) => m[1]);
    expect(conMlAuto).toContain("ml-auto");
    for (const clases of conMlAuto) expect(clases).not.toMatch(/\bhidden\b/);
  });
});
