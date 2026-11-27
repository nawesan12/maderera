import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DONDE_SE_CORTA, SUCURSALES, cortaPlacas, dondeSeCortaEn } from "@/lib/sucursales";

/**
 * Comité final, M20 y decisión 7: hasta que la clienta confirme, se corta en
 * el aserradero y nada ofrece cortar en Casa Central. Todo sale de
 * DONDE_SE_CORTA.
 */
describe("dónde se corta", () => {
  it("el armador ofrece solo las sucursales que cortan", () => {
    expect(DONDE_SE_CORTA.sucursales).toEqual(["aserradero"]);
    expect(cortaPlacas("aserradero")).toBe(true);
    expect(cortaPlacas("casa-central")).toBe(false);
    expect(DONDE_SE_CORTA.frase).toBe("en el aserradero");
  });

  it("el subtítulo sale de la sucursal elegida", () => {
    expect(dondeSeCortaEn("aserradero")).toBe("En el aserradero");
    expect(dondeSeCortaEn("casa-central")).toBe("En Casa Central");
  });

  it("los servicios de cada local dicen el corte solo donde se corta", () => {
    for (const s of SUCURSALES) {
      const anuncia = /corte/i.test(s.servicios) || /corte/i.test(s.destacados);
      expect(anuncia, s.slug).toBe(cortaPlacas(s.slug));
    }
  });

  it("el armador filtra los chips y arma el subtítulo con la elegida", () => {
    const vista = readFileSync(new URL("../app/(public)/corte/vista.tsx", import.meta.url), "utf8");
    expect(vista).toContain("sucursales.filter((s) => cortaPlacas(s.slug))");
    expect(vista).toContain("{ofrecidas.length > 1 && (");
    expect(vista).toContain("dondeSeCortaEn(sucursal)");
  });
});
