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
    expect(pagina).toMatch(/className="hidden min-w-0 truncate[^"]*sm:block"[^>]*>\{usuario\.name\}/);
  });
  it("formato y ayuda van en un menú debajo de md", () => {
    expect(pagina).toContain("<MenuDelTaller />");
    expect(pagina.match(/className="hidden h-11[^"]*md:inline-flex/g)).toHaveLength(2);
  });
});
