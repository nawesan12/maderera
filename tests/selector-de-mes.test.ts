import { describe, expect, it } from "vitest";
import { mesCorrido, nombreDelMes } from "@/components/admin/selector-de-mes";

describe("SelectorDeMes", () => {
  it("dice el mes en castellano (mes simulado, H171)", () => {
    expect(nombreDelMes("2026-11")).toBe("noviembre de 2026");
    expect(nombreDelMes("2027-01")).toBe("enero de 2027");
  });

  it("corre los meses sobre el cambio de año", () => {
    expect(mesCorrido("2026-01", -1)).toBe("2025-12");
    expect(mesCorrido("2026-12", 1)).toBe("2027-01");
  });
});
