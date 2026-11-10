import { describe, expect, it } from "vitest";
import { leerEnlaceDeCorte } from "@/lib/cortes/enlace";

const placas = [
  { variantId: "a", descripcion: "Fenólico — 1220 x 2440mm — 18mm" },
  { variantId: "b", descripcion: "Melamina Blanca — 1830 x 2600mm — 18mm" },
];

describe("leerEnlaceDeCorte", () => {
  it("la placa de la ficha", () => {
    expect(leerEnlaceDeCorte("#placa=b", placas)).toEqual({ placa: "b", piezas: [] });
  });
  it("el despiece del asistente, con la placa por el material", () => {
    expect(leerEnlaceDeCorte("#piezas=600x400x4c20_300x200x2&material=melamina+blanca", placas)).toEqual({
      placa: "b",
      piezas: [
        { largo: 600, ancho: 400, cantidad: 4, cantoLargo: 2, cantoAncho: 0 },
        { largo: 300, ancho: 200, cantidad: 2, cantoLargo: 0, cantoAncho: 0 },
      ],
    });
  });
  it("lo que no se entiende se ignora", () => {
    expect(leerEnlaceDeCorte("#piezas=hola_99x&placa=zz", placas)).toEqual({ placa: null, piezas: [] });
  });
});
