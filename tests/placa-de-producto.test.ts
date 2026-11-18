import { describe, expect, it } from "vitest";
import {
  ANCHO_DE_LETRA,
  ANCHO_UTIL_OG,
  LETRAS_POR_RENGLON,
  TONOS,
  contraste,
  escalaDelRubro,
  marcaDePlaca,
  palabraMasLarga,
  tamanoDelRubroEnOg,
  tonoDePlaca,
  type TonoDePlaca,
} from "@/lib/catalogo/placa";

/*
 * La placa que reemplaza a la foto de banco (hallazgo 25). Sin servidor no se
 * puede mirar; lo que sí se puede es que el tono siga al rubro y que el texto
 * se lea sobre cada madera, en claro y en oscuro.
 */
describe("tono de la placa", () => {
  it("sigue al rubro", () => {
    const casos: [string, TonoDePlaca][] = [
      ["placas", "pino"],
      ["molduras", "pino"],
      ["techos", "saligna"],
      ["pisos", "saligna"],
      ["decks-y-escaleras", "intemperie"],
      ["cubiertas", "intemperie"],
      ["ferreteria", "neutro"],
      ["construccion-en-seco", "neutro"],
    ];
    for (const [rubro, tono] of casos) expect(tonoDePlaca(rubro), rubro).toBe(tono);
  });

  it("un rubro desconocido o vacío va neutro", () => {
    expect(tonoDePlaca("rubro-nuevo")).toBe("neutro");
    expect(tonoDePlaca("")).toBe("neutro");
    expect(tonoDePlaca(null)).toBe("neutro");
  });

  it("es siempre el mismo para el mismo rubro", () => {
    expect(tonoDePlaca("placas")).toBe(tonoDePlaca("placas"));
  });

  it("ferretería y construcción en seco van lisas: sin veta", () => {
    expect(TONOS[tonoDePlaca("ferreteria")].veta).toBe(false);
    expect(TONOS[tonoDePlaca("placas")].veta).toBe(true);
  });
});

describe("contraste de la placa", () => {
  it("el texto da al menos 4,5:1 sobre cada madera, en claro y en oscuro", () => {
    for (const [nombre, tono] of Object.entries(TONOS)) {
      expect(contraste(tono.claro.fondo, tono.claro.texto), `${nombre} claro`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(tono.oscuro.fondo, tono.oscuro.texto), `${nombre} oscuro`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("en oscuro la madera es oscura y el texto claro", () => {
    for (const tono of Object.values(TONOS)) {
      expect(contraste(tono.oscuro.fondo, "#000000")).toBeLessThan(contraste(tono.claro.fondo, "#000000"));
    }
  });

  it("mide como WCAG", () => {
    expect(contraste("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contraste("#777777", "#777777")).toBe(1);
  });
});

describe("marca de la placa", () => {
  it("solo Moldava, en mayúsculas", () => {
    expect(marcaDePlaca("Moldava")).toBe("MOLDAVA");
    expect(marcaDePlaca("moldava")).toBe("MOLDAVA");
    expect(marcaDePlaca("Maderera Juan B. Justo")).toBeNull();
    expect(marcaDePlaca(null)).toBeNull();
  });
});

describe("el rubro entra en la placa (corrección de T5)", () => {
  // Los rubros y categorías del catálogo real, y uno inventado más largo.
  const RUBROS = [
    "Terminaciones",
    "Aislaciones",
    "Perfilería",
    "Tirantería",
    "Machimbres",
    "Accesorios",
    "Construcción en seco",
    "Decks y escaleras",
    "Pisos flotantes",
    "Tejados metálicos",
    "Impermeabilizantes",
    "MDF",
  ];

  it("en la imagen para compartir, la palabra más larga entra en el panel", () => {
    for (const rubro of RUBROS) {
      const ancho = tamanoDelRubroEnOg(rubro) * palabraMasLarga(rubro) * ANCHO_DE_LETRA;
      expect(ancho, rubro).toBeLessThanOrEqual(ANCHO_UTIL_OG);
    }
    expect(tamanoDelRubroEnOg("Placas")).toBe(72);
  });

  it("en la tarjeta y en la ficha, la palabra más larga no pasa de un renglón", () => {
    for (const rubro of RUBROS) {
      for (const tamano of ["tarjeta", "ficha"] as const) {
        const letras = palabraMasLarga(rubro) * escalaDelRubro(rubro, tamano);
        expect(letras, `${rubro} en ${tamano}`).toBeLessThanOrEqual(LETRAS_POR_RENGLON[tamano] + 1e-9);
      }
    }
    expect(escalaDelRubro("Placas", "tarjeta")).toBe(1);
  });
});
