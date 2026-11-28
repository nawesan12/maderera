import { describe, expect, it } from "vitest";
import { caminoDelPago } from "@/lib/pagos/camino";

/**
 * Lo que la dueña-admin y atención siguieron viendo mal en la prueba del
 * mes 23.
 */

describe("el camino de pago del seguimiento (M2S3-051)", () => {
  it("el pedido tomado con débito o crédito no ofrece Mercado Pago", () => {
    expect(caminoDelPago("debito", true, true)).toBe("al_retirar");
    expect(caminoDelPago("credito", true, false)).toBe("al_retirar");
    expect(caminoDelPago("efectivo", true, true)).toBe("al_retirar");
  });
  it("Mercado Pago ofrece «Pagar» solo con con qué cobrar", () => {
    expect(caminoDelPago("mercado_pago", true, true)).toBe("en_linea");
    expect(caminoDelPago("mercado_pago", false, true)).toBe("transferencia");
    expect(caminoDelPago("mercado_pago", false, false)).toBe("al_retirar");
  });
  it("la transferencia siempre es transferencia", () => {
    expect(caminoDelPago("transferencia", true, true)).toBe("transferencia");
  });
});

describe("los resúmenes concuerdan con 1 (Ndueña-admin-4 y 5)", () => {
  it("«1 creado · 1 quedó afuera», con puntos de miles", async () => {
    const { contar } = await import("@/lib/formato");
    expect(contar(1, "creado")).toBe("1 creado");
    expect(contar(1250, "creado")).toBe("1.250 creados");
    expect(contar(1, "quedó afuera", "quedaron afuera")).toBe("1 quedó afuera");
    expect(contar(0, "quedó afuera", "quedaron afuera")).toBe("0 quedaron afuera");
  });
});

describe("la bitácora muestra el antes y el después (Natención-5)", () => {
  it("los SKU de la lista del proveedor con su precio de antes y el nuevo", async () => {
    const { renglonesDelDetalle } = await import("@/lib/bitacora-detalle");
    const r = renglonesDelDetalle(
      JSON.stringify({ cambios: [{ sku: "PLA-MDF-18", antes: "78000.00", despues: "81876.92" }, { sku: "TOR", antes: null, despues: "500.00" }] }),
    );
    expect(r).toHaveLength(2);
    expect(r[0]).toMatch(/^PLA-MDF-18: \$\s?78\.000 → \$\s?81\.876,92$/);
    expect(r[1]).toMatch(/^TOR: — → \$\s?500$/);
  });
  it("el texto de un aviso y lo que no es un cambio", async () => {
    const { renglonesDelDetalle } = await import("@/lib/bitacora-detalle");
    expect(renglonesDelDetalle(JSON.stringify({ antes: "Hola", despues: "Hola {{nombre}}" }))).toEqual(["Hola → Hola {{nombre}}"]);
    expect(renglonesDelDetalle(JSON.stringify({ total: 28080 }))).toEqual([]);
    expect(renglonesDelDetalle(null)).toEqual([]);
    expect(renglonesDelDetalle("no es json")).toEqual([]);
  });
});
