import { describe, expect, it } from "vitest";
import {
  admiteMedia,
  descripcionConPresentacion,
  factorDeStock,
  precioDeLinea,
  precioDeMedia,
  presentacionDeMitad,
  unidadDeLinea,
  unidadesDeStock,
  type ProductoQueSeVende,
} from "@/lib/ventas/forma-de-venta";
import { fraccionDePlaca } from "@/lib/cortes/placa";

const mdf: ProductoQueSeVende = {
  unit: "placa",
  formaDeVenta: "entera_o_media",
  precioMediaPct: 55,
  largoMm: 2750,
  anchoMm: 1830,
};

const fenolico: ProductoQueSeVende = { ...mdf, formaDeVenta: "entera" };
const porM2: ProductoQueSeVende = { ...mdf, formaDeVenta: "metro_cuadrado" };

/**
 * La nota de la clienta del 30/9/2026: hay placas que se venden solo enteras,
 * otras enteras o por la mitad, y otras por metro cuadrado.
 *
 * Lo que se cuida acá es que el precio y el stock no se crucen: la media vale
 * su porcentaje —editable por producto— pero descuenta siempre media placa.
 */
describe("media placa", () => {
  it("vale el porcentaje cargado en el producto, redondeado al peso", () => {
    expect(precioDeMedia(100_000, 55)).toBe(55_000);
    expect(precioDeMedia(99_999, 50)).toBe(50_000);
    expect(precioDeLinea(100_000, mdf, "media_largo")).toBe(55_000);
  });

  it("descuenta media placa del stock, valga lo que valga", () => {
    expect(factorDeStock(mdf, "media_ancho")).toBe(0.5);
    expect(unidadesDeStock(3, factorDeStock(mdf, "media_largo"))).toBe(1.5);
  });

  it("no existe en una placa que se vende solo entera", () => {
    expect(admiteMedia(fenolico)).toBe(false);
    // Si igual llega una media, la línea se cobra y descuenta como entera.
    expect(precioDeLinea(100_000, fenolico, "media_largo")).toBe(100_000);
    expect(factorDeStock(fenolico, "media_largo")).toBe(1);
  });

  it("solo aplica a las placas", () => {
    const zocalo: ProductoQueSeVende = { ...mdf, unit: "metro_lineal" };
    expect(admiteMedia(zocalo)).toBe(false);
    expect(factorDeStock(zocalo, "media_largo")).toBe(1);
  });

  it("se nombra en el renglón", () => {
    expect(descripcionConPresentacion("MDF 18 mm — 2,75 × 1,83", "media_largo")).toBe(
      "MDF 18 mm — 2,75 × 1,83 — Media placa, al largo",
    );
    expect(descripcionConPresentacion("MDF 18 mm", null)).toBe("MDF 18 mm");
  });

  it("el corte sobre media placa cobra el mismo porcentaje que la venta suelta", () => {
    expect(fraccionDePlaca("largo", 55)).toBe(0.55);
    expect(fraccionDePlaca(null, 55)).toBe(1);
    // Sin porcentaje, la mitad: lo que hacía siempre.
    expect(fraccionDePlaca("ancho")).toBe(0.5);
    expect(presentacionDeMitad("ancho")).toBe("media_ancho");
    expect(presentacionDeMitad(null)).toBe(null);
  });
});

describe("placa por metro cuadrado", () => {
  it("se vende en m² con el precio de lista tal cual", () => {
    expect(unidadDeLinea(porM2)).toBe("metro_cuadrado");
    expect(precioDeLinea(9_800, porM2, null)).toBe(9_800);
  });

  it("descuenta del stock la fracción de placa que son esos m²", () => {
    // 2,75 × 1,83 = 5,0325 m²: diez m² son casi dos placas.
    expect(unidadesDeStock(10, factorDeStock(porM2, null))).toBe(1.987);
    // Una placa entera en m² descuenta exactamente una placa.
    expect(unidadesDeStock(5.0325, factorDeStock(porM2, null))).toBe(1);
  });

  it("sin medidas no se puede convertir y no se inventa", () => {
    expect(() =>
      factorDeStock({ ...porM2, largoMm: null, anchoMm: null }, null),
    ).toThrow(/largo y ancho/);
  });
});
