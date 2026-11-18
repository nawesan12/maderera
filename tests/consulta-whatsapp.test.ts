import { describe, expect, it } from "vitest";
import {
  TOPE_DE_CANTIDAD,
  cantidadConUnidad,
  cantidadDeConsulta,
  enlaceDeConsulta,
  textoDeConsulta,
} from "@/lib/catalogo/consulta";

const base = { producto: "Fenólico", medida: "1220 × 2440 mm — 18 mm", unidad: "placa" };

describe("cantidad de la consulta", () => {
  it("vacío, cero, negativo o texto: sin cantidad", () => {
    for (const t of ["", "  ", "0", "-3", "doce", "1,2,3", "0,2"]) expect(cantidadDeConsulta(t, "placa"), t).toBeNull();
  });

  it("acepta coma decimal en lo que se mide", () => {
    expect(cantidadDeConsulta("2,5", "metro_cuadrado")).toBe(2.5);
    expect(cantidadDeConsulta("3.75", "metro_lineal")).toBe(3.75);
  });

  it("redondea lo que se cuenta, la placa incluida", () => {
    expect(cantidadDeConsulta("2,6", "unidad")).toBe(3);
    expect(cantidadDeConsulta("12,4", "placa")).toBe(12);
  });

  it("topea en 9999", () => {
    expect(cantidadDeConsulta("150000", "placa")).toBe(TOPE_DE_CANTIDAD);
  });

  it("singular y plural, con la unidad dicha en una oración", () => {
    expect(cantidadConUnidad(1, "placa")).toBe("1 placa");
    expect(cantidadConUnidad(12, "placa")).toBe("12 placas");
    expect(cantidadConUnidad(2.5, "metro_cuadrado")).toBe("2,5 metros cuadrados");
    expect(cantidadConUnidad(2, "par")).toBe("2 pares");
  });
});

describe("texto de la consulta", () => {
  it("sin cantidad sale como siempre", () => {
    expect(textoDeConsulta(base)).toBe("Hola! Quería el precio de Fenólico — 1220 × 2440 mm — 18 mm. ¿Tienen disponible?");
  });

  it("con cantidad, código y media placa", () => {
    expect(
      textoDeConsulta({ ...base, cantidad: 12, como: "media placa, al largo", codigo: "FEN-18" }),
    ).toBe("Hola! Quería el precio de 12 placas de Fenólico — 1220 × 2440 mm — 18 mm (media placa, al largo) [FEN-18]. ¿Tienen disponible?");
  });

  it("una sola", () => {
    expect(textoDeConsulta({ ...base, cantidad: 1 })).toContain("de 1 placa de Fenólico");
  });
});

describe("enlace de wa.me", () => {
  it("codifica todo lo que rompe en Android: «×», «—», «ñ», «²» y los signos", () => {
    const texto = "Hola! Quería 2,5 metros cuadrados de Caña — 1220 × 2440 mm (m²) & ¿hay?";
    const enlace = enlaceDeConsulta("54 9 223 590-3118", texto);
    expect(enlace.startsWith("https://wa.me/5492235903118?text=")).toBe(true);
    const crudo = enlace.split("?text=")[1];
    // Nada sin codificar fuera de lo que encodeURIComponent deja pasar.
    expect(crudo).toMatch(/^[A-Za-z0-9\-_.!~*'()%]+$/);
    expect(crudo).toContain("%C3%97"); // ×
    expect(crudo).toContain("%E2%80%94"); // —
    expect(crudo).toContain("%C3%B1"); // ñ
    expect(crudo).toContain("%C2%B2"); // ²
    expect(crudo).toContain("%26"); // &
    expect(decodeURIComponent(crudo)).toBe(texto);
  });
});
