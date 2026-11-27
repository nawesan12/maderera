import { describe, expect, it } from "vitest";
import {
  CLAVES_EN_LAS_LISTAS_DEL_DEPOSITO,
  mesesConVentas,
  paraEntregar,
  paraPreparar,
  partirPendientes,
} from "@/lib/inicio";

// Hallazgo 31 (T7): la primera pantalla del panel.

describe("partirPendientes", () => {
  it("deja en «Para hoy» solo lo urgente, sin cambiar el orden", () => {
    const { paraHoy, pendientes } = partirPendientes([
      { clave: "preparar", urgente: true },
      { clave: "reponer" },
      { clave: "cheques-48h", urgente: true },
      { clave: "catalogo-foto", urgente: false },
    ]);
    expect(paraHoy.map((p) => p.clave)).toEqual(["preparar", "cheques-48h"]);
    expect(pendientes.map((p) => p.clave)).toEqual(["reponer", "catalogo-foto"]);
  });

  it("saca lo que la pantalla ya muestra en una lista", () => {
    const { paraHoy, pendientes } = partirPendientes(
      [
        { clave: "preparar", urgente: true },
        { clave: "cortes", urgente: true },
        { clave: "pedidos-atrasados", urgente: true },
        // Los cortes terminados van en «Para entregar» (M2S4-047).
        { clave: "cortes-sin-retirar" },
        { clave: "reponer" },
      ],
      CLAVES_EN_LAS_LISTAS_DEL_DEPOSITO,
    );
    expect(paraHoy.map((p) => p.clave)).toEqual(["pedidos-atrasados"]);
    expect(pendientes.map((p) => p.clave)).toEqual(["reponer"]);
  });

  it("sin urgentes, «Para hoy» queda vacío", () => {
    expect(partirPendientes<{ clave: string; urgente?: boolean }>([{ clave: "reponer" }]).paraHoy).toEqual([]);
  });
});

describe("mesesConVentas", () => {
  const mes = (...totales: number[]) => ({
    mes: "x",
    sucursales: totales.map((total, i) => ({ sucursal: `s${i}`, nombre: `S${i}`, total })),
  });
  it("cuenta los meses con ventas en alguna sucursal", () => {
    // Una tercera sucursal cuenta igual que las otras dos (hallazgo 35).
    expect(mesesConVentas([mes(0, 0, 7), mes(0, 0, 0)])).toBe(1);
    expect(mesesConVentas([mes(0, 0), mes(0, 0)])).toBe(0);
    expect(mesesConVentas([mes(0, 0), mes(100, 0)])).toBe(1);
    expect(mesesConVentas([mes(100, 0), mes(0, 0), mes(0, 50)])).toBe(2);
    expect(mesesConVentas([mes(1, 1), mes(2, 0), mes(0, 3), mes(0, 0)])).toBe(3);
  });
});

describe("paraPreparar", () => {
  const pedido = (numero: string, estado: string, dia: number) => ({
    id: numero,
    numero,
    cliente: "Cliente",
    estado,
    tipoEntrega: "retiro",
    zonaEnvio: null,
    estadoPago: "pendiente",
    createdAt: new Date(2026, 10, dia),
    total: 123456,
  });

  it("cuenta lo mismo que Go y pone primero el que espera hace más", () => {
    const { renglones, total } = paraPreparar([
      pedido("PED-3", "pendiente", 3),
      pedido("PED-1", "preparando", 1),
      pedido("PED-2", "listo", 2),
      pedido("PED-4", "en-camino", 4),
    ]);
    expect(total).toBe(2);
    expect(renglones.map((r) => r.numero)).toEqual(["PED-1", "PED-3"]);
  });

  it("muestra cinco y dice cuántos hay", () => {
    const muchos = Array.from({ length: 23 }, (_, i) => pedido(`PED-${i}`, "pendiente", i + 1));
    const { renglones, total } = paraPreparar(muchos);
    expect(renglones).toHaveLength(5);
    expect(total).toBe(23);
  });

  it("no manda importes al depósito", () => {
    const { renglones } = paraPreparar([pedido("PED-1", "pendiente", 1)]);
    expect(Object.keys(renglones[0])).not.toContain("total");
  });
});

// Mes simulado, H396: el depósito entrega desde el inicio.
describe("paraEntregar", () => {
  const pedido = (numero: string, estado: string, dia: number, sinCobrar: number | null = null) => ({
    id: numero,
    numero,
    cliente: "Cliente",
    estado,
    tipoEntrega: "retiro",
    zonaEnvio: null,
    estadoPago: "pendiente",
    sinCobrar,
    createdAt: new Date(2026, 10, dia),
    total: 123456,
  });

  it("solo los listos, como el chip de Go, y el más viejo primero", () => {
    const { renglones, total } = paraEntregar([
      pedido("PED-3", "listo", 3),
      pedido("PED-1", "listo", 1, 500),
      pedido("PED-2", "en-camino", 2),
      pedido("PED-4", "preparando", 4),
    ]);
    expect(total).toBe(2);
    expect(renglones.map((r) => r.numero)).toEqual(["PED-1", "PED-3"]);
    expect(renglones[0].sinCobrar).toBe(500);
  });

  // H104: el acopio en curso viaja al renglón para que el botón sea «Preparar remito».
  it("dice si es un acopio en curso", () => {
    const { renglones } = paraEntregar([{ ...pedido("PED-1", "listo", 1), acopio: true }, pedido("PED-2", "listo", 2)]);
    expect(renglones.map((r) => r.acopio)).toEqual([true, false]);
  });

  it("no manda el total al depósito", () => {
    const { renglones } = paraEntregar([pedido("PED-1", "listo", 1)]);
    expect(Object.keys(renglones[0])).not.toContain("total");
  });

  it("el inicio del depósito saca de «Para hoy» lo que ya está en sus listas", () => {
    const { paraHoy } = partirPendientes(
      [
        { clave: "entregar", urgente: true },
        { clave: "pedidos-atrasados", urgente: true },
      ],
      CLAVES_EN_LAS_LISTAS_DEL_DEPOSITO,
    );
    expect(paraHoy.map((p) => p.clave)).toEqual(["pedidos-atrasados"]);
  });
});
