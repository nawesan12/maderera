import { describe, expect, it } from "vitest";
import {
  disponibilidadJsonLd,
  horariosJsonLd,
  productoJsonLd,
  sucursalJsonLd,
} from "@/lib/seo";

/**
 * Los datos estructurados se prueban porque nadie los mira.
 *
 * Salen del HTML hacia Google y de ahí a la ficha del costado de la búsqueda:
 * si un horario queda mal, no rompe ninguna pantalla y nadie se entera hasta
 * que alguien llega al local un sábado a la tarde.
 */

describe("horarios de sucursal", () => {
  it("lee el formato que escribe el cliente en el panel", () => {
    const tramos = horariosJsonLd("Lun a Vie 8:00-16:00 · Sáb 8:00-12:00");

    expect(tramos).toHaveLength(2);
    expect(tramos[0]).toMatchObject({
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "08:00",
      closes: "16:00",
    });
    expect(tramos[1]).toMatchObject({ dayOfWeek: ["Saturday"], closes: "12:00" });
  });

  it("aguanta las variantes de escritura", () => {
    for (const texto of [
      "LUNES A VIERNES 8:00 A 16:00",
      "lun-vie 8.00-16.00",
      "Lun a Vie de 08:00 hasta 16:00",
    ]) {
      const [tramo] = horariosJsonLd(texto);
      expect(tramo, texto).toMatchObject({ opens: "08:00", closes: "16:00" });
    }
  });

  it("prefiere no declarar horario antes que declarar uno inventado", () => {
    // Si el texto no se puede interpretar, no se marca nada: un horario
    // equivocado en el marcado manda gente al local con el local cerrado.
    expect(horariosJsonLd("Consultar por WhatsApp")).toEqual([]);
    expect(horariosJsonLd(null)).toEqual([]);
  });
});

describe("ficha de sucursal", () => {
  const base = {
    slug: "casa-central",
    name: "Casa Central",
    address: "Av. Juan B. Justo 4153, Mar del Plata",
    phone: "(0223) 474-3328",
    email: "info@mjbj.com.ar",
    hours: "Lun a Vie 8:00-16:00",
    whatsapp: "+542235903118",
  };

  it("parte la dirección en calle y localidad", () => {
    const ficha = sucursalJsonLd(base) as Record<string, Record<string, string>>;

    expect(ficha.address.streetAddress).toBe("Av. Juan B. Justo 4153");
    expect(ficha.address.addressLocality).toBe("Mar del Plata");
  });

  it("cae a Mar del Plata cuando la dirección viene sin coma", () => {
    const ficha = sucursalJsonLd({
      ...base,
      address: "Canosa 61",
    }) as Record<string, Record<string, string>>;

    expect(ficha.address.streetAddress).toBe("Canosa 61");
    expect(ficha.address.addressLocality).toBe("Mar del Plata");
  });

  it("omite los campos que no están en vez de mandarlos vacíos", () => {
    const ficha = sucursalJsonLd({ ...base, phone: null, email: null, hours: null });

    expect(ficha).not.toHaveProperty("telephone");
    expect(ficha).not.toHaveProperty("email");
    expect(ficha).not.toHaveProperty("openingHoursSpecification");
  });
});

describe("marcado de producto", () => {
  const producto = {
    slug: "fenolico",
    name: "Fenólico",
    description: "Placa fenólica para encofrado.",
    brand: "Moldava",
    categoryName: "Placas",
    imagenes: ["/fotos/fenolico.jpg"],
  };

  it("arma un rango cuando hay varias medidas con precio", () => {
    const marcado = productoJsonLd({
      ...producto,
      variantes: [
        { sku: "F-18", label: "18mm", precio: "96500.00", disponibilidad: "alto" },
        { sku: "F-12", label: "12mm", precio: "72000.00", disponibilidad: "bajo" },
      ],
    }) as Record<string, Record<string, unknown>>;

    expect(marcado.offers["@type"]).toBe("AggregateOffer");
    expect(marcado.offers.lowPrice).toBe("72000.00");
    expect(marcado.offers.highPrice).toBe("96500.00");
    expect(marcado.offers.offerCount).toBe(2);
  });

  it("usa una oferta suelta cuando hay una sola medida", () => {
    const marcado = productoJsonLd({
      ...producto,
      variantes: [
        { sku: "F-18", label: "18mm", precio: "96500.00", disponibilidad: "alto" },
      ],
    }) as Record<string, Record<string, unknown>>;

    expect(marcado.offers["@type"]).toBe("Offer");
    expect(marcado.offers.price).toBe("96500.00");
  });

  it("deja afuera las medidas sin precio", () => {
    // Una oferta sin precio es una advertencia en Search Console y no le sirve
    // a nadie: el producto se publica igual, pero sin esa medida.
    const marcado = productoJsonLd({
      ...producto,
      variantes: [
        { sku: "F-18", label: "18mm", precio: "96500.00", disponibilidad: "alto" },
        { sku: "F-05", label: "5.5mm", precio: null, disponibilidad: "alto" },
        { sku: "F-09", label: "9mm", precio: "0", disponibilidad: "alto" },
      ],
    }) as Record<string, Record<string, unknown>>;

    expect(marcado.offers["@type"]).toBe("Offer");
    expect(marcado.offers.sku).toBe("F-18");
  });

  it("no publica ofertas cuando ningún precio está cargado", () => {
    const marcado = productoJsonLd({
      ...producto,
      variantes: [
        { sku: "F-18", label: "18mm", precio: null, disponibilidad: "alto" },
      ],
    });

    expect(marcado).not.toHaveProperty("offers");
    expect(marcado.name).toBe("Fenólico");
  });

  it("hace absolutas las rutas de las fotos", () => {
    const marcado = productoJsonLd({
      ...producto,
      variantes: [],
    }) as Record<string, string[]>;

    expect(marcado.image[0]).toMatch(/^https?:\/\/.+\/fotos\/fenolico\.jpg$/);
  });
});

describe("disponibilidad", () => {
  it("solo marca sin stock lo que realmente no está", () => {
    // "bajo" y "medio" son cantidades chicas, no falta de mercadería.
    expect(disponibilidadJsonLd("alto")).toContain("InStock");
    expect(disponibilidadJsonLd("medio")).toContain("InStock");
    expect(disponibilidadJsonLd("bajo")).toContain("InStock");
    expect(disponibilidadJsonLd("sin-stock")).toContain("OutOfStock");
  });
});
