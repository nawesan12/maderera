import { describe, expect, it } from "vitest";
import { leerPeriodo, resolverPeriodo } from "@/lib/periodos";

/**
 * Las fechas de corte deciden qué números ve alguien que está por tomar una
 * decisión con ellos. Un mes que arranca un día tarde deja una venta afuera del
 * total y nadie lo nota.
 *
 * El "ahora" de las pruebas es el 15 de marzo de 2026, elegido para que el mes
 * anterior tenga 28 días: febrero es donde se rompe el cálculo ingenuo de
 * restarle 30 días a la fecha.
 */
const AHORA = new Date(2026, 2, 15, 14, 30);

describe("resolverPeriodo", () => {
  it("este mes arranca el día 1 a las 00:00", () => {
    const p = resolverPeriodo("mes", AHORA);
    expect(p.desde).toEqual(new Date(2026, 2, 1));
    expect(p.hasta).toBeNull();
  });

  it("compara contra el mismo lapso anterior, no contra 30 días", () => {
    const p = resolverPeriodo("mes", AHORA);
    // Febrero de 2026 tiene 28 días: restar 30 daría el 13 de febrero.
    expect(p.anterior?.desde).toEqual(new Date(2026, 1, 1));
    expect(p.anterior?.hasta).toEqual(new Date(2026, 2, 1));
  });

  it("el mes pasado es un lapso cerrado, no abierto hasta hoy", () => {
    const p = resolverPeriodo("mes-pasado", AHORA);
    expect(p.desde).toEqual(new Date(2026, 1, 1));
    expect(p.hasta).toEqual(new Date(2026, 2, 1));
  });

  it("cruza bien el año", () => {
    const enero = new Date(2026, 0, 10);
    expect(resolverPeriodo("mes", enero).anterior?.desde).toEqual(
      new Date(2025, 11, 1),
    );
    expect(resolverPeriodo("anio", enero).anterior?.desde).toEqual(
      new Date(2025, 0, 1),
    );
  });

  it("«todo» no recorta ni compara", () => {
    const p = resolverPeriodo("todo", AHORA);
    expect(p.desde).toBeNull();
    expect(p.anterior).toBeNull();
  });
});

describe("leerPeriodo", () => {
  it("acepta las claves conocidas", () => {
    expect(leerPeriodo("anio")).toBe("anio");
    expect(leerPeriodo("todo")).toBe("todo");
  });

  it("cae en «este mes» ante cualquier cosa rara", () => {
    // Llega de la URL, así que puede venir cualquier cosa.
    expect(leerPeriodo(undefined)).toBe("mes");
    expect(leerPeriodo("")).toBe("mes");
    expect(leerPeriodo("../../etc/passwd")).toBe("mes");
  });
});
