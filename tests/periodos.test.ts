import { describe, expect, it } from "vitest";
import {
  comoTexto,
  leerPeriodo,
  leerRango,
  resolverPeriodo,
} from "@/lib/periodos";

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

describe("rango de fechas libre", () => {
  it("una sola fecha es ese día entero", () => {
    // La pregunta real: "¿cuánto facturamos de contado el sábado?". Pedir dos
    // veces la misma fecha para contestarla sería un paso de más.
    const rango = leerRango("2026-03-14", null)!;
    expect(comoTexto(rango.desde)).toBe("2026-03-14");
    expect(comoTexto(rango.hasta)).toBe("2026-03-14");
    expect(rango.hasta.getHours()).toBe(23);
    expect(rango.hasta.getMinutes()).toBe(59);
  });

  it("toma las dos puntas", () => {
    const rango = leerRango("2026-03-01", "2026-03-15")!;
    expect(comoTexto(rango.desde)).toBe("2026-03-01");
    expect(comoTexto(rango.hasta)).toBe("2026-03-15");
  });

  it("da vuelta un rango escrito al revés", () => {
    // "Del 15 al 1" quiere decir del 1 al 15, no un resultado vacío.
    const rango = leerRango("2026-03-15", "2026-03-01")!;
    expect(comoTexto(rango.desde)).toBe("2026-03-01");
    expect(comoTexto(rango.hasta)).toBe("2026-03-15");
  });

  it("sin fechas no hay rango", () => {
    expect(leerRango(null, null)).toBeNull();
    expect(leerRango("", "")).toBeNull();
  });

  it("descarta lo que no es una fecha", () => {
    // La URL la puede escribir cualquiera.
    expect(leerRango("marzo", null)).toBeNull();
    expect(leerRango("2026-13-40", null)).toBeNull();
  });
});
