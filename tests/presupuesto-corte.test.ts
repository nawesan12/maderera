import { describe, expect, it } from "vitest";
import { calcularPlanoDeCorte, type PiezaAcortar } from "@/lib/cortes/plano";
import { presupuestarCorte } from "@/lib/cortes/presupuesto";
import type { TarifaDeCorte } from "@/lib/cortes/tarifa";

/**
 * Lo que se le cobra a alguien que pide un corte.
 *
 * La regla que se prueba acá es la del negocio: **si de una placa sale más de
 * la mitad, se le vende la placa entera y el corte va sin cargo**. Equivocarse
 * para un lado es regalar media placa; para el otro, cobrarle a alguien una
 * placa que no se llevó.
 */

const PLACA = { placaLargo: 2750, placaAncho: 1830 };
const PRECIO_PLACA = 120_000;

const TARIFA: TarifaDeCorte = {
  material: "Melamina",
  priceListId: null,
  precioPorPasada: 1_200,
  precioPorMetroCanto: 900,
};

function pieza(p: Partial<PiezaAcortar>): PiezaAcortar {
  return {
    largoMm: 600,
    anchoMm: 400,
    cantidad: 1,
    respetaVeta: 0,
    cantoLargo: 0,
    cantoAncho: 0,
    ...p,
  };
}

function presupuesto(piezas: PiezaAcortar[], precioPlaca = PRECIO_PLACA) {
  const plano = calcularPlanoDeCorte({ piezas, ...PLACA });
  return {
    plano,
    cuenta: presupuestarCorte({
      plano,
      tarifa: TARIFA,
      precioPorPlaca: precioPlaca,
      piezas,
    }),
  };
}

describe("cuando sale menos de media placa", () => {
  // Una pieza de 600 × 400 sobre una placa de 2750 × 1830 es el 5 %.
  const { plano, cuenta } = presupuesto([pieza({ cantidad: 1 })]);

  it("no se vende ninguna placa entera", () => {
    expect(plano.placasEnteras).toBe(0);
    expect(cuenta.subtotalPlacas).toBe(0);
  });

  it("se cobra el corte por pasada", () => {
    expect(cuenta.pasadasCobrables).toBeGreaterThan(0);
    expect(cuenta.subtotalCorte).toBe(cuenta.pasadasCobrables * 1_200);
    expect(cuenta.total).toBe(cuenta.subtotalCorte);
  });

  it("no dice que falte nada: el precio es firme", () => {
    expect(cuenta.faltan).toEqual([]);
  });
});

describe("cuando sale más de media placa", () => {
  // 2700 × 1000 sobre 2750 × 1830 es el 53,6 %: pasa el umbral.
  const { plano, cuenta } = presupuesto([
    pieza({ largoMm: 2700, anchoMm: 1000, cantidad: 1 }),
  ]);

  it("se vende la placa entera", () => {
    expect(plano.placas).toHaveLength(1);
    expect(plano.placas[0]!.seVendeEntera).toBe(true);
    expect(cuenta.placasEnteras).toBe(1);
    expect(cuenta.subtotalPlacas).toBe(PRECIO_PLACA);
  });

  it("el corte de esa placa no se cobra", () => {
    expect(cuenta.pasadasCobrables).toBe(0);
    expect(cuenta.subtotalCorte).toBe(0);
    expect(cuenta.total).toBe(PRECIO_PLACA);
  });

  it("marca la placa como vendida entera, que es lo que se dibuja", () => {
    // La decisión no se narra: se ve en el chip de cada placa del plano.
    expect(plano.placas.every((p) => p.seVendeEntera)).toBe(true);
  });
});

describe("un trabajo con placas de las dos clases", () => {
  /*
   * Dos placas llenas y una tercera apenas mordida. Es el caso real: se venden
   * dos enteras y de la tercera se cobra solo el corte. Promediarlo en un único
   * porcentaje le cobraría de más a unos y de menos a otros.
   */
  const { plano, cuenta } = presupuesto([
    pieza({ largoMm: 1340, anchoMm: 900, cantidad: 4 }),
    pieza({ largoMm: 400, anchoMm: 300, cantidad: 2 }),
  ]);

  it("cobra las enteras al precio de la placa y el resto por pasada", () => {
    expect(plano.placas.length).toBeGreaterThan(1);
    expect(cuenta.placasEnteras).toBeGreaterThan(0);
    expect(cuenta.subtotalPlacas).toBe(cuenta.placasEnteras * PRECIO_PLACA);
    expect(cuenta.total).toBe(
      cuenta.subtotalPlacas + cuenta.subtotalCorte + cuenta.subtotalCanto,
    );
  });

  it("no cobra las pasadas de las placas que se venden enteras", () => {
    expect(cuenta.pasadasCobrables).toBeLessThan(plano.pasadas);
  });
});

describe("el tapacanto va aparte", () => {
  it("se cobra por metro, se venda o no la placa entera", () => {
    const { cuenta } = presupuesto([
      pieza({ largoMm: 1000, anchoMm: 500, cantidad: 2, cantoLargo: 2 }),
    ]);

    expect(cuenta.metrosCanto).toBeGreaterThan(0);
    expect(cuenta.subtotalCanto).toBe(
      Math.round(cuenta.metrosCanto * 900 * 100) / 100,
    );
  });
});

describe("qué falta para que el precio sea firme", () => {
  it("avisa si no hay precio de placa y hay que vender una entera", () => {
    const { cuenta } = presupuesto(
      [pieza({ largoMm: 2700, anchoMm: 1000, cantidad: 1 })],
      0,
    );
    expect(cuenta.faltan.join(" ")).toContain("precio de la placa");
  });

  it("avisa si no hay tarifa de corte", () => {
    const piezas = [pieza({ cantidad: 1 })];
    const plano = calcularPlanoDeCorte({ piezas, ...PLACA });
    const cuenta = presupuestarCorte({
      plano,
      tarifa: null,
      precioPorPlaca: PRECIO_PLACA,
      piezas,
    });
    expect(cuenta.faltan.join(" ")).toContain("tarifa de corte");
    expect(cuenta.subtotalCorte).toBe(0);
  });

  it("avisa si una pieza no entra, en vez de dar un precio de mentira", () => {
    const { cuenta } = presupuesto([
      pieza({ largoMm: 4000, anchoMm: 3000, cantidad: 1 }),
    ]);
    expect(cuenta.faltan.join(" ")).toContain("no entra");
  });

  it("sin piezas no hay precio", () => {
    const { cuenta } = presupuesto([]);
    expect(cuenta.total).toBe(0);
    expect(cuenta.faltan.join(" ")).toContain("Cargá el despiece");
  });
});

describe("media placa", () => {
  it("cobra la mitad del material", () => {
    // El trabajo sale de media placa: el plano ya se armó sobre la medida
    // partida, así que lo que cambia es el precio del material. Cobrar la
    // placa entera sería venderle al cliente lo que se queda la maderera.
    const piezas: PiezaAcortar[] = [
      { largoMm: 2000, anchoMm: 800, cantidad: 1, respetaVeta: 0 },
    ];
    const plano = calcularPlanoDeCorte({
      piezas,
      placaLargo: 2750,
      placaAncho: 915,
    });

    const entera = presupuestarCorte({
      plano,
      tarifa: TARIFA,
      precioPorPlaca: 100_000,
      piezas,
    });
    const media = presupuestarCorte({
      plano,
      tarifa: TARIFA,
      precioPorPlaca: 100_000,
      piezas,
      fraccion: 0.5,
    });

    expect(entera.placasEnteras).toBe(1);
    expect(media.placasEnteras).toBe(1);
    expect(media.subtotalPlacas).toBe(entera.subtotalPlacas / 2);
    // El corte se cobra igual: las pasadas son las mismas.
    expect(media.subtotalCorte).toBe(entera.subtotalCorte);
  });
});
