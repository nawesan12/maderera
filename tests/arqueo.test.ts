import { describe, expect, it } from "vitest";
import {
  importeDeCaja,
  nombreDeLaDiferencia,
  TOLERANCIA_ARQUEO,
} from "@/lib/mostrador/arqueo";

/**
 * Cómo se llama una diferencia de caja.
 *
 * Se prueba porque el número con signo obliga a traducir —«−3.500» no dice
 * «falta»— y porque de esta función depende que el cierre exija una explicación:
 * si la tolerancia se corriera, se podrían cerrar turnos con faltantes sin que
 * nadie escriba una palabra.
 */
describe("la diferencia del arqueo", () => {
  it("un redondeo no es una diferencia", () => {
    expect(nombreDeLaDiferencia(0)).toBe("sin diferencia");
    expect(nombreDeLaDiferencia(TOLERANCIA_ARQUEO)).toBe("sin diferencia");
    expect(nombreDeLaDiferencia(-TOLERANCIA_ARQUEO)).toBe("sin diferencia");
  });

  it("de menos es faltante", () => {
    // Se contó menos de lo que debería haber.
    expect(nombreDeLaDiferencia(-3500)).toBe("faltante");
  });

  it("de más es sobrante", () => {
    // También hay que explicarlo: casi siempre es una venta mal cargada.
    expect(nombreDeLaDiferencia(2000)).toBe("sobrante");
  });

  it("la tolerancia es de un peso y no de mil", () => {
    // Fijarla en el test es a propósito: subirla sin querer sería dejar pasar
    // faltantes sin nota.
    expect(TOLERANCIA_ARQUEO).toBe(1);
    expect(nombreDeLaDiferencia(1.5)).toBe("sobrante");
  });
});

/**
 * La caja del mostrador leía «15.000» como $15 (comité final, M13): los
 * campos eran numéricos y se leían con `Number()`.
 */
describe("lo tipeado en la caja", () => {
  it("lee los miles con punto y los decimales con coma", () => {
    expect(importeDeCaja("15.000")).toBe(15000);
    expect(importeDeCaja("15.000,50")).toBe(15000.5);
    expect(importeDeCaja("1.234.567")).toBe(1234567);
    expect(importeDeCaja("2500")).toBe(2500);
    expect(importeDeCaja("0")).toBe(0);
  });
  it("lo que no es un importe no se manda", () => {
    expect(importeDeCaja("")).toBeNull();
    expect(importeDeCaja("abc")).toBeNull();
    expect(importeDeCaja("-500")).toBeNull();
  });
});
