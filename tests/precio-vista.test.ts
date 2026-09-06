import { describe, expect, it } from "vitest";
import { presentarComparado, presentarPrecio } from "@/lib/precios/vista";

describe("presentarPrecio", () => {
  it("al público muestra el final grande y el neto abajo", () => {
    const p = presentarPrecio(48500, 21, "final");
    expect(p.principal).toBe(48500);
    expect(p.sufijo).toBe("");
    expect(p.secundario.etiqueta).toBe("Sin impuestos nacionales");
    expect(p.secundario.monto).toBeCloseTo(40082.64, 2);
  });

  it("al gremio muestra el neto grande y el final abajo", () => {
    const p = presentarPrecio(48500, 21, "neto");
    expect(p.principal).toBeCloseTo(40082.64, 2);
    expect(p.sufijo).toBe("+ IVA");
    expect(p.secundario.etiqueta).toBe("Final con IVA");
    expect(p.secundario.monto).toBe(48500);
  });

  it("los dos números son el mismo precio, mirado de los dos lados", () => {
    const publico = presentarPrecio(48500, 21, "final");
    const gremio = presentarPrecio(48500, 21, "neto");
    expect(publico.principal).toBe(gremio.secundario.monto);
    expect(publico.secundario.monto).toBe(gremio.principal);
  });

  it("respeta la alícuota de la variante y no el 21 fijo", () => {
    // Una alícuota distinta cambia el neto. Si el componente asumiera 21,
    // el dato obligatorio de la ley 27.743 saldría mal.
    const p = presentarPrecio(11050, 10.5, "final");
    expect(p.secundario.monto).toBeCloseTo(10000, 2);
  });

  it("el tachado de la oferta va en la misma vista que el precio", () => {
    // Si el tachado quedara en final y el nuevo en neto, el descuento
    // aparentaría 21 puntos más de los que es.
    const anterior = presentarComparado(60000, 21, "neto");
    const ahora = presentarPrecio(48500, 21, "neto").principal;
    const descuento = 1 - ahora / anterior;
    expect(descuento).toBeCloseTo(1 - 48500 / 60000, 6);
  });
});
