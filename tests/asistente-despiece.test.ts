import { describe, expect, it } from "vitest";
import { conContexto, entender, enlaceDelDespiece, leerDespiece } from "@/lib/asistente/lenguaje";

describe("leerDespiece", () => {
  it("lee cantidades, medidas, canto y material", () => {
    const d = leerDespiece("Necesito 4 de 600x400 en melamina blanca con canto");
    expect(d?.piezas).toEqual([{ largoMm: 600, anchoMm: 400, cantidad: 4, cantoLargo: 2, cantoAncho: 0 }]);
    expect(d?.material).toBe("melamina blanca");
  });

  it("varias piezas en la misma frase, en cualquier orden de medida", () => {
    const d = leerDespiece("cortame 2 piezas de 400 x 900 y 300x200 x 6, canto en los 4 lados");
    expect(d?.piezas).toEqual([
      { largoMm: 900, anchoMm: 400, cantidad: 2, cantoLargo: 2, cantoAncho: 2 },
      { largoMm: 300, anchoMm: 200, cantidad: 6, cantoLargo: 2, cantoAncho: 2 },
    ]);
  });

  it("la medida de una placa entera no es un despiece", () => {
    expect(leerDespiece("tenés fenólico 2440x1220?")).toBeNull();
    expect(leerDespiece("hola")).toBeNull();
  });

  it("con la palabra corte alcanza una sola medida", () => {
    expect(leerDespiece("quiero un corte de 800x600")?.piezas[0].cantidad).toBe(1);
  });
});

describe("entender, temas nuevos", () => {
  it.each([
    ["4 de 600x400 en mdf", "armar_corte"],
    ["qué es moldava?", "moldava"],
    ["tienen la ficha tecnica del fenolico", "documentacion"],
    ["puedo devolver una placa?", "devoluciones"],
    ["puedo dejar el material en acopio", "acopio"],
    ["me hacen factura a?", "factura"],
    ["hay alguna capacitacion?", "eventos"],
  ])("%s → %s", (frase, intencion) => {
    expect(entender(frase).intencion).toBe(intencion);
  });
});

describe("conContexto", () => {
  it("completa la pregunta que sigue", () => {
    expect(conContexto("y en 18?", "mdf")).toBe("mdf y en 18?");
    expect(conContexto("de 15mm", "melamina blanca")).toBe("melamina blanca de 15mm");
  });
  it("si nombra otra cosa, va sola", () => {
    expect(conContexto("y tirantes de pino?", "mdf")).toBe("y tirantes de pino?");
    expect(conContexto("hola", null)).toBe("hola");
  });
});

it("el enlace al cortador lleva las piezas y el material", () => {
  expect(enlaceDelDespiece({ piezas: [{ largoMm: 600, anchoMm: 400, cantidad: 4, cantoLargo: 2, cantoAncho: 0 }], material: "melamina blanca" })).toBe(
    "/corte#piezas=600x400x4c20&material=melamina+blanca",
  );
});
