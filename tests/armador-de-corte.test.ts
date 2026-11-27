import { describe, expect, it } from "vitest";
import { leerPiezasDelEnlace } from "@/lib/cortes/enlace";
import {
  filasDelEnlace,
  leerBorrador,
  medidasDelBorrador,
  medidasSospechosas,
  nombreDelTapacanto,
  textoDelPedido,
  type PiezaDelPedido,
} from "@/lib/cortes/armador";

/**
 * El armador de cortes del sitio, en lo que no es pantalla. Lo que se prueba
 * es lo que llega al taller: si la veta se pierde en un enlace o el mensaje
 * mezcla las piezas de dos placas, la pieza sale cortada al revés o de la
 * placa equivocada, y eso no tiene arreglo.
 */

describe("el enlace al cortador", () => {
  it("lee la veta cuando viene", () => {
    expect(leerPiezasDelEnlace("600x400x4c20v_300x200x2v_100x100x1")).toEqual([
      { largo: 600, ancho: 400, cantidad: 4, cantoLargo: 2, cantoAncho: 0, veta: true },
      { largo: 300, ancho: 200, cantidad: 2, cantoLargo: 0, cantoAncho: 0, veta: true },
      { largo: 100, ancho: 100, cantidad: 1, cantoLargo: 0, cantoAncho: 0, veta: false },
    ]);
  });

  it("los enlaces viejos, sin veta, se leen igual que antes", () => {
    expect(leerPiezasDelEnlace("600x400x4c20_300x200x2")).toEqual([
      { largo: 600, ancho: 400, cantidad: 4, cantoLargo: 2, cantoAncho: 0, veta: false },
      { largo: 300, ancho: 200, cantidad: 2, cantoLargo: 0, cantoAncho: 0, veta: false },
    ]);
    expect(leerPiezasDelEnlace("600x400x4x_basura_600x400x4vv")).toEqual([]);
  });

  it("la veta llega a la fila", () => {
    const [f] = filasDelEnlace(leerPiezasDelEnlace("600x400x4c21v"));
    expect(f).toMatchObject({ largo: "600", ancho: "400", cantidad: "4", veta: true });
    expect(f!.lados).toEqual({ arriba: true, abajo: true, izquierda: true, derecha: false });
  });
});

describe("el borrador del navegador", () => {
  it("el de una sola placa, de antes de los grupos, se retoma como un grupo", () => {
    const viejo = JSON.stringify({
      variantId: "v1",
      canto: "Blanco",
      filas: [{ nombre: "Lateral", largo: "700", ancho: "400", cantidad: "2", veta: true }],
    });
    const b = leerBorrador(viejo)!;
    expect(b.grupos).toHaveLength(1);
    expect(b.grupos[0]).toMatchObject({ variantId: "v1", canto: "Blanco", cantoId: null, modo: "piezas" });
    expect(b.grupos[0]!.filas[0]).toMatchObject({ nombre: "Lateral", veta: true, lados: { arriba: false } });
    expect(medidasDelBorrador(b)).toBe(1);
  });

  it("guarda y retoma varias placas", () => {
    const crudo = JSON.stringify({
      grupos: [
        { variantId: "mel", mitad: "largo", canto: "PVC", cantoId: "t1", filas: [{ largo: "700", ancho: "400" }] },
        { variantId: "fibro", filas: [{ largo: "690", ancho: "390" }, { largo: "", ancho: "" }] },
      ],
    });
    const b = leerBorrador(crudo)!;
    expect(b.grupos.map((g) => [g.variantId, g.mitad, g.cantoId])).toEqual([
      ["mel", "largo", "t1"],
      ["fibro", null, null],
    ]);
    expect(medidasDelBorrador(b)).toBe(2);
    expect(new Set(b.grupos.map((g) => g.clave)).size).toBe(2);
  });

  it("sin medidas o roto no ofrece nada", () => {
    expect(leerBorrador(JSON.stringify({ grupos: [{ variantId: "x", filas: [{ largo: "", ancho: "" }] }] }))).toBeNull();
    expect(leerBorrador("{no es json")).toBeNull();
    expect(leerBorrador(null)).toBeNull();
  });
});

describe("el nombre del tapacanto", () => {
  it("suma el tipo y el espesor cuando la descripción no los dice", () => {
    expect(nombreDelTapacanto({ descripcion: "Tapacanto — Blanco", tipo: "PVC", espesorMm: 0.45 })).toBe(
      "Tapacanto — Blanco · PVC · 0,45 mm",
    );
    expect(nombreDelTapacanto({ descripcion: "Tapacanto — Roble", tipo: "Melamínico", espesorMm: 2 })).toBe(
      "Tapacanto — Roble · Melamínico · 2 mm",
    );
  });

  it("no repite lo que ya dice", () => {
    expect(nombreDelTapacanto({ descripcion: "Cinta PVC — Blanco 22 x 0,45 mm", tipo: "PVC", espesorMm: 0.45 })).toBe(
      "Cinta PVC — Blanco 22 x 0,45 mm",
    );
    expect(nombreDelTapacanto({ descripcion: "Tapacanto melamínico — Roble 0.45", tipo: "Melamínico", espesorMm: 0.45 })).toBe(
      "Tapacanto melamínico — Roble 0.45",
    );
    // El 22 del ancho del rollo no es el espesor de 2 mm.
    expect(nombreDelTapacanto({ descripcion: "Tapacanto — Negro 22 mm", tipo: null, espesorMm: 2 })).toBe(
      "Tapacanto — Negro 22 mm · 2 mm",
    );
    expect(nombreDelTapacanto({ descripcion: "Tapacanto — Gris", tipo: null, espesorMm: null })).toBe("Tapacanto — Gris");
  });
});

describe("el mensaje de WhatsApp", () => {
  const pieza = (p: Partial<PiezaDelPedido>): PiezaDelPedido => ({
    largoMm: 700,
    anchoMm: 400,
    cantidad: 1,
    respetaVeta: 0,
    cantoLargo: 0,
    cantoAncho: 0,
    etiqueta: null,
    ...p,
  });

  it("con una placa queda como siempre", () => {
    const texto = textoDelPedido(
      [
        {
          placa: "Melamina Blanca — 2750 × 1830 mm — 18mm",
          mitad: null,
          canto: "PVC Blanco 0,45 mm",
          piezas: [pieza({ etiqueta: "Lateral", cantidad: 2, respetaVeta: 1, cantoLargo: 1 })],
        },
      ],
      "https://mjbj.test/corte/c/abc",
    );
    expect(texto).toBe(
      [
        "Hola! Quería pedir este corte:",
        "Placa: Melamina Blanca — 2750 × 1830 mm — 18mm",
        "• Lateral: 2 de 700 × 400 mm, con veta, canto en 1 largo",
        "Tapacanto: PVC Blanco 0,45 mm",
        "https://mjbj.test/corte/c/abc",
      ].join("\n"),
    );
  });

  it("sin ninguna pieza con canto no nombra el tapacanto (M2S2-145)", () => {
    const texto = textoDelPedido(
      [{ placa: "Melamina 18", mitad: null, canto: "Blanco 22 mm", piezas: [pieza({ etiqueta: "Sim Lateral" })] }],
      "https://mjbj.test/corte/c/abc",
    );
    expect(texto).not.toContain("Tapacanto");
  });

  it("con varias, cada placa con sus piezas y su canto", () => {
    const texto = textoDelPedido(
      [
        { placa: "Melamina 18", mitad: null, canto: "PVC Blanco", piezas: [pieza({ cantoLargo: 2, cantoAncho: 2 })] },
        { placa: "Fibrofácil 3", mitad: "largo", canto: " ", piezas: [pieza({ largoMm: 690, anchoMm: 390 })] },
      ],
      "https://mjbj.test/corte/c/abc",
    );
    expect(texto).toBe(
      [
        "Hola! Quería pedir este corte:",
        "Placa: Melamina 18",
        "• 1 de 700 × 400 mm, canto en 2 largos y 2 anchos",
        "Tapacanto: PVC Blanco",
        "",
        "Placa: Fibrofácil 3 (media, al largo)",
        "• 1 de 690 × 390 mm, sin canto",
        "https://mjbj.test/corte/c/abc",
      ].join("\n"),
    );
  });
});

describe("¿están en mm?", () => {
  // T4, hallazgo 22: el carpintero dice «60 por 40» y se tipea 60 × 40.
  it("todas las piezas de menos de 10 cm por lado: se pregunta", () => {
    expect(medidasSospechosas([{ largo: "60", ancho: "40" }, { largo: "99", ancho: "99" }])).toBe(true);
  });

  it("con una pieza grande ya no hay duda", () => {
    expect(medidasSospechosas([{ largo: "60", ancho: "40" }, { largo: "600", ancho: "400" }])).toBe(false);
  });

  it("un mueble en cm, aunque tenga piezas de más de un metro: se pregunta", () => {
    // Placard dictado en cm (comité de T4): con el 180 la regla vieja callaba.
    expect(
      medidasSospechosas([
        { largo: "180", ancho: "45" },
        { largo: "80", ancho: "45" },
        { largo: "120", ancho: "45" },
      ]),
    ).toBe(true);
    expect(medidasSospechosas([{ largo: "244", ancho: "60" }])).toBe(true);
    expect(medidasSospechosas([{ largo: "180", ancho: "55" }, { largo: "76", ancho: "50" }])).toBe(true);
  });

  it("el borde: con un lado de 300 mm ya no es sospechoso", () => {
    expect(medidasSospechosas([{ largo: "300", ancho: "50" }, { largo: "60", ancho: "40" }])).toBe(false);
    expect(medidasSospechosas([{ largo: "50", ancho: "300" }])).toBe(false);
    expect(medidasSospechosas([{ largo: "299", ancho: "50" }])).toBe(true);
  });

  it("sin piezas cargadas no se pregunta nada", () => {
    expect(medidasSospechosas([])).toBe(false);
    expect(medidasSospechosas([{ largo: "", ancho: "" }])).toBe(false);
    // Una medida a medias no cuenta, ni para un lado ni para el otro.
    expect(medidasSospechosas([{ largo: "60", ancho: "" }])).toBe(false);
  });

  it("la coma es decimal: 60,5 son sesenta milímetros y medio, no 605", () => {
    expect(medidasSospechosas([{ largo: "60,5", ancho: "40" }])).toBe(true);
    expect(medidasSospechosas([{ largo: "60.5", ancho: "40" }])).toBe(true);
  });

  it("lo que no es número no cuenta", () => {
    expect(medidasSospechosas([{ largo: "abc", ancho: "40" }, { largo: "600", ancho: "40" }])).toBe(false);
  });
});

describe("el selector de canto", () => {
  // Comité de T4: «Ninguno» adentro de una pieza con los cuatro lados y
  // «4 lados» en cada renglón vacío se leían como el estado. El cuerpo no
  // lleva texto, y en la planilla con el dedo no se toca.
  it("el cuerpo de la pieza no dice la acción, y con el dedo cada lado mide 24 px", async () => {
    const { readFileSync } = await import("node:fs");
    const fuente = readFileSync(new URL("../components/cortes/selector-canto.tsx", import.meta.url), "utf8");
    expect(fuente).not.toMatch(/"Ninguno"|"4 lados"|"2 lados"/);
    expect(fuente).toMatch(/pointer-coarse:pointer-events-none/);
    expect(fuente.match(/pointer-coarse:(h|w)-6/g)).toHaveLength(4);
  });
});

describe("el canto en el armador público (comité final)", () => {
  it("el rótulo dice qué lleva, o «Sin canto»", async () => {
    const { estadoDelCanto, SIN_CANTO } = await import("@/components/cortes/selector-canto");
    expect(estadoDelCanto(SIN_CANTO)).toBe("Sin canto");
    expect(estadoDelCanto({ ...SIN_CANTO, arriba: true })).toBe("1 largo");
    expect(estadoDelCanto({ arriba: true, abajo: true, izquierda: true, derecha: false })).toBe("2 largos y 1 ancho");
    expect(estadoDelCanto({ arriba: true, abajo: false, izquierda: true, derecha: true }, true)).toBe("1 largo");
  });

  it("la planilla y las tiras lo muestran, y el tapacanto trae el ejemplo", async () => {
    const { readFileSync } = await import("node:fs");
    const vista = readFileSync(new URL("../app/(public)/corte/vista.tsx", import.meta.url), "utf8");
    expect(vista.match(/<SelectorDeCanto[\s\S]*?conEstado/g)).toHaveLength(2);
    expect(vista).toContain('placeholder="Tapacanto: blanco, o el de la placa"');
  });
});
