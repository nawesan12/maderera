import { describe, expect, it } from "vitest";
import { aIso, aPantalla, conBarras, sinImposibles } from "@/lib/fecha-texto";

describe("fecha escrita dd/mm/aaaa", () => {
  it("va y vuelve contra aaaa-mm-dd", () => {
    expect(aPantalla("2026-11-05")).toBe("05/11/2026");
    expect(aIso("05/11/2026")).toBe("2026-11-05");
    expect(aIso("5/1/2026")).toBe("2026-01-05");
    expect(aPantalla("")).toBe("");
    expect(aPantalla(null)).toBe("");
  });

  it("no acepta fechas que no existen", () => {
    expect(aIso("31/02/2026")).toBeNull();
    expect(aIso("29/02/2027")).toBeNull();
    expect(aIso("29/02/2028")).toBe("2028-02-29");
    expect(aIso("11/2026")).toBeNull();
  });

  it("pone las barras y corta lo imposible al escribir", () => {
    expect(conBarras("2511")).toBe("25/11");
    expect(conBarras("25112026")).toBe("25/11/2026");
    expect(conBarras("251120261")).toBe("25/11/2026");
    expect(sinImposibles("32")).toBe("3");
    expect(conBarras("3113")).toBe("31/1");
    expect(conBarras("ab12-03/2026")).toBe("12/03/2026");
    // Pegada como aaaa-mm-dd (M2S4-036): antes quedaba «20/2».
    expect(conBarras("2026-12-30")).toBe("30/12/2026");
    expect(conBarras("2026-1-5")).toBe("05/01/2026");
  });
});
