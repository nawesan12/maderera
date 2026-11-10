import { describe, expect, it } from "vitest";
import { tirasDePlaca } from "@/lib/cortes/tiras";

describe("tirasDePlaca", () => {
  it("cubre los metros con tiras del largo de la placa, redondeando para arriba", () => {
    expect(tirasDePlaca({ anchoMm: 80, metros: 12, cantoLargo: 0 }, 2750)).toMatchObject({
      largoMm: 2750,
      anchoMm: 80,
      cantidad: 5,
      respetaVeta: 1,
    });
  });

  it("los metros justos no suman una tira de más", () => {
    expect(tirasDePlaca({ anchoMm: 100, metros: 5.5, cantoLargo: 2 }, 2750)?.cantidad).toBe(2);
  });

  it("sin datos no hay tiras", () => {
    expect(tirasDePlaca({ anchoMm: 0, metros: 3, cantoLargo: 0 }, 2750)).toBeNull();
    expect(tirasDePlaca({ anchoMm: 50, metros: 0, cantoLargo: 0 }, 2750)).toBeNull();
  });
});
