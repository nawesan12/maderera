import { describe, expect, it } from "vitest";
import { ETIQUETA_CIRCUITO, etiquetaDeCircuito } from "@/lib/circuito";

/**
 * Los dos circuitos, como los nombra el equipo.
 *
 * Se prueba porque las etiquetas cambiaron —de «En blanco / En negro» a
 * «Facturas / B», por pedido de la clienta— y porque el valor guardado en la
 * base **no** cambió: son `blanco` y `negro` en 61 migraciones. Si algún día
 * alguien renombra el enum creyendo que la pantalla y la base dicen lo mismo,
 * esto se cae acá y no en producción.
 */
describe("cómo se llama cada circuito", () => {
  it("el que se factura se llama Facturas", () => {
    expect(ETIQUETA_CIRCUITO.blanco).toBe("Facturas");
  });

  it("el otro se llama B", () => {
    expect(ETIQUETA_CIRCUITO.negro).toBe("B");
  });

  it("traduce cualquier valor que venga de la base", () => {
    expect(etiquetaDeCircuito("blanco")).toBe("Facturas");
    expect(etiquetaDeCircuito("negro")).toBe("B");
  });

  it("un valor desconocido se muestra tal cual, sin romper la pantalla", () => {
    expect(etiquetaDeCircuito("violeta")).toBe("violeta");
  });
});
