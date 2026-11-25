import { describe, expect, it } from "vitest";
import { tarifaDeCorte, type TarifaDeCorte } from "@/lib/cortes/tarifa";

/*
 * El archivo para el optimizador (formatos) se mudó a Go con su golden
 * (backend/internal/cortes, testdata/golden/cortes). Queda la búsqueda de
 * tarifa del mostrador, que sigue en TS hasta la tanda 5.
 */

/**
 * La tarifa se busca por categoría, no por el nombre del producto.
 *
 * Es el defecto que hizo que el corte **no se cobrara en ningún lado**: las
 * tarifas se cargan por familia —"Placas", como las dio el brief— y el corte
 * guarda el nombre completo de lo que se corta, "Melamina Blanca — 1830 x
 * 2600mm — 18mm". Comparar esas dos cadenas nunca daba verdadero, así que la
 * pantalla decía "no hay tarifa cargada" para todo y el trabajo salía en cero.
 * Se descubrió vendiendo un corte desde el mostrador.
 */
describe("por dónde se busca la tarifa", () => {
  const tarifas: TarifaDeCorte[] = [
    {
      material: "Placas",
      priceListId: null,
      precioPorPasada: 1200,
      precioPorMetroCanto: 900,
    },
    {
      material: "Placas",
      priceListId: "lista-mayorista",
      precioPorPasada: 996,
      precioPorMetroCanto: 750,
    },
  ];

  it("la encuentra por la categoría del producto", () => {
    const t = tarifaDeCorte(
      tarifas,
      ["Placas", "Melamina Blanca — 1830 x 2600mm — 18mm"],
      null,
    );
    expect(t?.precioPorPasada).toBe(1200);
  });

  it("el nombre completo del producto, solo, no alcanza", () => {
    // Es exactamente lo que pasaba antes: ninguna tarifa coincide.
    const t = tarifaDeCorte(
      tarifas,
      "Melamina Blanca — 1830 x 2600mm — 18mm",
      null,
    );
    expect(t).toBeNull();
  });

  it("prueba los candidatos en orden y se queda con el primero que existe", () => {
    // Sin categoría —material que trajo el cliente— cae a la descripción.
    const t = tarifaDeCorte(tarifas, ["", "Placas"], null);
    expect(t?.precioPorPasada).toBe(1200);
  });

  it("respeta la lista del cliente sobre la categoría encontrada", () => {
    const t = tarifaDeCorte(tarifas, ["Placas"], "lista-mayorista");
    expect(t?.precioPorPasada).toBe(996);
  });

  it("sin ninguna coincidencia devuelve nulo en vez de inventar un precio", () => {
    expect(tarifaDeCorte(tarifas, ["Ferretería", "Tarugo"], null)).toBeNull();
  });
});
