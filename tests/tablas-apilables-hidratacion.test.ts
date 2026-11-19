import { describe, expect, it, vi } from "vitest";
import { cuandoEsteQuieto, type VentanaQuieta } from "@/components/admin/tablas-apilables";

/**
 * Comité final: las tablas apilables escribían `data-label` antes de que
 * React hidratara la página, y salían avisos de hidratación. Ahora esperan a
 * que la página cargue y el hilo quede libre.
 */
function ventana(readyState: string) {
  const alCargar: (() => void)[] = [];
  const ociosos = new Map<number, () => void>();
  let siguiente = 1;
  const v: VentanaQuieta & { cargar(): void; quedarQuieta(): void; ociosos: Map<number, () => void> } = {
    document: { readyState },
    addEventListener: (_t, fn) => alCargar.push(fn),
    removeEventListener: (_t, fn) => {
      const i = alCargar.indexOf(fn);
      if (i >= 0) alCargar.splice(i, 1);
    },
    requestIdleCallback: (fn) => {
      ociosos.set(siguiente, fn);
      return siguiente++;
    },
    cancelIdleCallback: (id) => ociosos.delete(id),
    setTimeout: () => 0,
    clearTimeout: () => {},
    cargar() {
      v.document.readyState = "complete";
      for (const fn of alCargar.splice(0)) fn();
    },
    quedarQuieta() {
      for (const [id, fn] of [...ociosos]) {
        ociosos.delete(id);
        fn();
      }
    },
    ociosos,
  };
  return v;
}

describe("las tablas apilables esperan a la hidratación", () => {
  it("no escriben nada mientras la página carga", () => {
    const v = ventana("loading");
    const rotular = vi.fn();
    cuandoEsteQuieto(v, rotular);
    expect(rotular).not.toHaveBeenCalled();
    v.cargar();
    expect(rotular).not.toHaveBeenCalled();
    v.quedarQuieta();
    expect(rotular).toHaveBeenCalledTimes(1);
  });

  it("con la página cargada, esperan a que el hilo quede libre", () => {
    const v = ventana("complete");
    const rotular = vi.fn();
    cuandoEsteQuieto(v, rotular);
    expect(rotular).not.toHaveBeenCalled();
    v.quedarQuieta();
    expect(rotular).toHaveBeenCalledTimes(1);
  });

  it("cancelar antes de tiempo no rotula", () => {
    const v = ventana("loading");
    const rotular = vi.fn();
    const cancelar = cuandoEsteQuieto(v, rotular);
    v.cargar();
    cancelar();
    v.quedarQuieta();
    expect(rotular).not.toHaveBeenCalled();
  });
});
