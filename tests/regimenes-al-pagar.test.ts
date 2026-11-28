import { describe, expect, it } from "vitest";
import { alicuotaPara, regimenesQueRetienen, tildadosAlArrancar, type Regimen } from "@/app/admin/compras/pagos/regimenes";

const regimen = (id: string, impuesto: string, alicuota: number, alicuotaNoInscripto: number): Regimen => ({
  id,
  codigo: id.toUpperCase(),
  nombre: id,
  impuesto,
  alicuota,
  alicuotaNoInscripto,
  minimoNoImponible: 0,
});

// Los de producción: Ganancias por compra de bienes es 0 % para el inscripto
// y 2 % para el no inscripto; IIBB de Misiones, 1,5 %.
const bienes = regimen("gan-bienes", "ganancias", 0, 2);
const iibb = regimen("iibb-mi", "iibb", 1.5, 1.5);
const regimenes = [bienes, iibb];
const inscripto = { condicionIva: "responsable_inscripto", condicionGanancias: "inscripto", exentoGananciasHasta: null };
const noInscripto = { ...inscripto, condicionGanancias: "no_inscripto" };

describe("regímenes al pagar (recorrido 2)", () => {
  it("al inscripto no se le ofrece ni se le tilda el 0 %, aunque ese mes ya tenga base", () => {
    expect(regimenesQueRetienen(regimenes, inscripto, "2026-11-28").map((r) => r.id)).toEqual(["iibb-mi"]);
    expect(tildadosAlArrancar(regimenes, inscripto, "2026-11-28", new Set(["GAN-BIENES", "IIBB-MI"]), false)).toEqual(["iibb-mi"]);
  });

  it("al no inscripto se le ofrece con su alícuota, no con la del inscripto", () => {
    expect(alicuotaPara(bienes, noInscripto)).toBe(2);
    expect(alicuotaPara(bienes, inscripto)).toBe(0);
    expect(tildadosAlArrancar(regimenes, noInscripto, "2026-11-28", new Set(["GAN-BIENES"]), false)).toEqual(["gan-bienes"]);
  });

  it("con «las que corresponden», la única de cada impuesto", () => {
    expect(tildadosAlArrancar(regimenes, noInscripto, "2026-11-28", new Set(), true)).toEqual(["gan-bienes", "iibb-mi"]);
    expect(tildadosAlArrancar(regimenes, noInscripto, "2026-11-28", new Set(), false)).toEqual([]);
  });
});
