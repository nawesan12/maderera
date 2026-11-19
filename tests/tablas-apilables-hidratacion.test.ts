import { describe, expect, it, vi } from "vitest";
import { cuandoEsteQuieto, rotularAgrupado, type VentanaQuieta } from "@/components/admin/tablas-apilables";

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

describe("los cambios seguidos no posponen el rótulo para siempre", () => {
  it("un cambio con una espera en marcha no la reinicia", () => {
    const v = ventana("complete");
    const rotular = vi.fn();
    const { programar } = rotularAgrupado(v, rotular);
    programar();
    // Un tablero en vivo: cambia una y otra vez antes de quedar quieto.
    for (let i = 0; i < 20; i++) programar();
    expect(v.ociosos.size).toBe(1);
    v.quedarQuieta();
    expect(rotular).toHaveBeenCalledTimes(1);
  });

  it("después de rotular, el cambio siguiente vuelve a programar", () => {
    const v = ventana("complete");
    const rotular = vi.fn();
    const { programar } = rotularAgrupado(v, rotular);
    programar();
    v.quedarQuieta();
    programar();
    v.quedarQuieta();
    expect(rotular).toHaveBeenCalledTimes(2);
  });

  it("cancelar al desmontar no rotula", () => {
    const v = ventana("complete");
    const rotular = vi.fn();
    const { programar, cancelar } = rotularAgrupado(v, rotular);
    programar();
    cancelar();
    v.quedarQuieta();
    expect(rotular).not.toHaveBeenCalled();
  });
});
