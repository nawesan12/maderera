import { describe, expect, it } from "vitest";
import {
  armarCsv,
  enteroCsv,
  fechaCsv,
  numeroCsv,
  textoCsv,
} from "@/lib/csv-excel";
import { leerPeriodoMensual } from "@/lib/periodos";

/**
 * El dialecto de Excel en español no es una manía: cada una de estas tres cosas
 * es un archivo que alguien tuvo que rearmar a mano.
 */
describe("csv para Excel en español", () => {
  it("usa coma decimal, porque con punto Excel no lo puede sumar", () => {
    expect(numeroCsv(1234.56)).toBe("1234,56");
    expect(numeroCsv(0)).toBe("0,00");
    expect(numeroCsv(-99.9)).toBe("-99,90");
  });

  it("los enteros no llevan decimales", () => {
    // Un "2,00" donde va un "2" obliga a arreglar el formato de la columna.
    expect(enteroCsv(2)).toBe("2");
    expect(enteroCsv(2.4)).toBe("2");
  });

  it("escapa las comillas en vez de romper la columna", () => {
    expect(textoCsv('Placa 18" reforzada')).toBe('"Placa 18"" reforzada"');
    expect(textoCsv(null)).toBe('""');
  });

  it("la fecha va como la lee Excel en español", () => {
    expect(fechaCsv(new Date(2026, 8, 3))).toBe("03/09/2026");
    expect(fechaCsv(null)).toBe("");
  });

  it("empieza con el BOM, sin el cual los acentos llegan rotos", () => {
    const csv = armarCsv(["Producto"], [[textoCsv("Melamínica")]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Melamínica");
  });

  it("separa con punto y coma y corta con CRLF", () => {
    const csv = armarCsv(
      ["A", "B"],
      [[textoCsv("uno"), numeroCsv(1.5)]],
      [textoCsv("Total"), numeroCsv(1.5)],
    );

    const lineas = csv.replace("﻿", "").trimEnd().split("\r\n");
    expect(lineas).toHaveLength(3);
    expect(lineas[0]).toBe('"A";"B"');
    expect(lineas[1]).toBe('"uno";1,50');
    expect(lineas[2]).toBe('"Total";1,50');
  });
});

/**
 * El período del libro IVA estaba escrito dos veces con la misma fórmula
 * copiada. Estos casos fijan los bordes, que es donde una copia se desincroniza
 * de la otra.
 */
describe("período mensual", () => {
  const ahora = new Date(2026, 8, 3);

  it("lee AAAA-MM", () => {
    const p = leerPeriodoMensual("2026-03", ahora);
    expect(p.anio).toBe(2026);
    expect(p.mes).toBe(3);
    expect(p.clave).toBe("2026-03");
  });

  it("incluye el último milisegundo del último día", () => {
    // Un comprobante emitido a las 23:50 del 31 pertenece a ese mes.
    const p = leerPeriodoMensual("2026-01", ahora);
    expect(p.hasta.getDate()).toBe(31);
    expect(p.hasta.getHours()).toBe(23);
    expect(p.hasta.getMinutes()).toBe(59);
  });

  it("resuelve bien febrero y los bisiestos", () => {
    expect(leerPeriodoMensual("2026-02", ahora).hasta.getDate()).toBe(28);
    expect(leerPeriodoMensual("2028-02", ahora).hasta.getDate()).toBe(29);
  });

  it("sin período usa el mes actual", () => {
    const p = leerPeriodoMensual(null, ahora);
    expect(p.anio).toBe(2026);
    expect(p.mes).toBe(9);
  });

  it("un mes fuera de rango no genera fechas absurdas", () => {
    expect(leerPeriodoMensual("2026-13", ahora).mes).toBe(12);
    expect(leerPeriodoMensual("2026-00", ahora).mes).toBe(9);
  });
});
