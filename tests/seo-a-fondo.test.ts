import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventoJsonLd,
  metadatosDePagina,
  organizacionJsonLd,
  queVaria,
  recortar,
  sitioIndexable,
  sucursalJsonLd,
  telefonoInternacional,
  urlParaSitemap,
} from "@/lib/seo";
import { SUCURSALES } from "@/lib/sucursales";
import { REDES } from "@/lib/empresa";
import { TEXTOS_DE_CATEGORIA } from "@/lib/textos-categorias";
import {
  armarFeedMerchant,
  disponibilidadMerchant,
  escaparXml,
  type ProductoParaFeed,
} from "@/lib/merchant";

/**
 * Lo que se sumó en la pasada de SEO del 14/10/2026.
 *
 * Como el resto del marcado, falla en silencio: una canónica equivocada o un
 * feed con un precio de más no rompen ninguna pantalla, se notan semanas
 * después en Search Console.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sitemap y variantes", () => {
  it("escapa el & de las URLs, que Next escribe crudo", () => {
    expect(urlParaSitemap("/catalogo?cat=placas&rubro=melaminas")).toMatch(
      /\/catalogo\?cat=placas&amp;rubro=melaminas$/,
    );
    expect(urlParaSitemap("https://images.unsplash.com/x?w=800&q=80")).toBe(
      "https://images.unsplash.com/x?w=800&amp;q=80",
    );
  });

  it("una variante sin medidas que tiene color varía por color", () => {
    expect(queVaria({ color: "Rojo teja", conMedidas: false })).toBe("color");
    expect(queVaria({ color: "Blanco", conMedidas: true })).toBe("size");
    expect(queVaria({})).toBe("size");
  });
});

describe("metadata de página", () => {
  it("cada página declara su canónica, y la tarjeta para compartir es la suya", () => {
    const m = metadatosDePagina({
      titulo: "Corte de placas a medida",
      descripcion: "Armá tu despiece.",
      ruta: "/corte",
    });

    expect(m.alternates?.canonical).toBe("/corte");
    expect(m.openGraph?.title).toBe("Corte de placas a medida | Maderera Juan B. Justo");
    // La de Twitter (y WhatsApp, que lee las dos) dice lo mismo, no lo de la
    // portada: era el error que tenían las fichas.
    expect(m.twitter?.title).toBe(m.openGraph?.title);
    // Sin imagen propia, la del sitio: si no, al compartir no había ninguna.
    expect(JSON.stringify(m.openGraph?.images)).toContain("/opengraph-image");
  });

  it("lo que no se indexa lleva noindex pero se sigue", () => {
    const m = metadatosDePagina({
      titulo: "Buscar",
      descripcion: "x",
      ruta: "/catalogo",
      indexar: false,
    });
    expect(m.robots).toEqual({ index: false, follow: true });
  });

  it("recorta la descripción en una palabra entera", () => {
    const largo = "palabra ".repeat(40);
    const r = recortar(largo, 160);
    expect(r.length).toBeLessThanOrEqual(160);
    expect(r.endsWith("…")).toBe(true);
    expect(r).not.toMatch(/\s…$/);
  });
});

describe("indexación en el servidor propio", () => {
  it("una copia publicada en localhost no se indexa aunque diga production", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("SEO_INDEXAR", "");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect(sitioIndexable()).toBe(false);
  });

  it("el dominio real con APP_ENV=production se indexa", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("SEO_INDEXAR", "");
    vi.stubEnv("APP_URL", "https://mjbj.com.ar");
    expect(sitioIndexable()).toBe(true);
  });

  it("SEO_INDEXAR=si fuerza la indexación para medir en local", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("SEO_INDEXAR", "si");
    vi.stubEnv("APP_URL", "http://localhost:3102");
    expect(sitioIndexable()).toBe(true);
  });
});

describe("sucursales", () => {
  it("cada sucursal es un comercio con su ficha, geo y horario", () => {
    for (const s of SUCURSALES) {
      const marcado = sucursalJsonLd({
        slug: s.slug,
        name: s.nombre,
        address: s.direccion,
        phone: s.telefono,
        email: s.email,
        hours: s.horario,
        whatsapp: s.whatsapp,
        geo: s.geo,
        mapa: s.mapUrl,
        foto: s.foto?.ruta,
      }) as Record<string, unknown> & { address: Record<string, string> };

      expect(marcado["@type"]).toBe("HardwareStore");
      expect(marcado.url).toMatch(new RegExp(`/sucursales/${s.slug}$`));
      expect(marcado["@id"]).toMatch(new RegExp(`/sucursales/${s.slug}#local$`));
      expect(marcado.telephone).toBe(telefonoInternacional(s.telefono));
      expect(marcado.openingHoursSpecification).toHaveLength(2);
      expect(marcado.geo).toBeDefined();
      // El NAP del marcado es el texto de la página, sin variaciones.
      expect(`${marcado.address.streetAddress}, ${marcado.address.addressLocality}`).toBe(
        s.direccion,
      );
    }
  });

  it("las coordenadas caen en Mar del Plata", () => {
    for (const s of SUCURSALES) {
      expect(s.geo!.lat).toBeGreaterThan(-38.1);
      expect(s.geo!.lat).toBeLessThan(-37.9);
      expect(s.geo!.lng).toBeGreaterThan(-57.7);
      expect(s.geo!.lng).toBeLessThan(-57.5);
    }
  });

  it("el teléfono va con el código de país", () => {
    expect(telefonoInternacional("223 590-3118")).toBe("+54 223 590-3118");
    expect(telefonoInternacional("+5492235903118")).toBe("+5492235903118");
  });
});

describe("organización", () => {
  it("enlaza las redes reales y los dos locales", () => {
    const marcado = organizacionJsonLd({
      redes: [REDES.facebook, REDES.instagram],
      sucursales: SUCURSALES.map((s) => s.slug),
    }) as Record<string, unknown> & { sameAs: string[]; subOrganization: unknown[] };

    expect(marcado.sameAs).toContain("https://www.instagram.com/madererajuanbjusto/");
    // Las del prototipo, que no eran de la empresa, no vuelven.
    expect(JSON.stringify(marcado)).not.toContain("madererajbjusto");
    expect(marcado.subOrganization).toHaveLength(SUCURSALES.length);
  });
});

describe("eventos", () => {
  const base = {
    slug: "charla-melamina",
    titulo: "Charla de melamina",
    resumen: "Cómo elegir la placa.",
    descripcion: null,
    imagenUrl: null,
    lugar: "Casa Central",
    inicia: new Date("2026-11-01T13:00:00Z"),
    termina: new Date("2026-11-01T15:00:00Z"),
    cupo: 20,
    inscriptos: 5,
    precio: "0",
  };

  it("es un evento presencial con su oferta", () => {
    const e = eventoJsonLd(base) as Record<string, Record<string, string>>;
    expect(e["@type"]).toBe("Event");
    expect(e.eventAttendanceMode).toContain("Offline");
    expect(e.offers.price).toBe("0.00");
    expect(e.offers.availability).toContain("InStock");
  });

  it("con el cupo lleno figura agotado", () => {
    const e = eventoJsonLd({ ...base, inscriptos: 20 }) as Record<string, Record<string, string>>;
    expect(e.offers.availability).toContain("SoldOut");
  });
});

describe("textos de categoría", () => {
  it("las ocho categorías tienen texto propio y no se repiten", () => {
    const slugs = [
      "techos",
      "placas",
      "pisos",
      "molduras",
      "ferreteria",
      "decks-y-escaleras",
      "construccion-en-seco",
      "cubiertas",
    ];
    for (const slug of slugs) expect(TEXTOS_DE_CATEGORIA[slug], slug).toBeDefined();
    const titulos = new Set(slugs.map((s) => TEXTOS_DE_CATEGORIA[s].titulo));
    expect(titulos.size).toBe(slugs.length);
  });

  it("no afirma años ni cantidades que puedan quedar viejos", () => {
    const todo = JSON.stringify(TEXTOS_DE_CATEGORIA);
    expect(todo).not.toMatch(/\d+\s*años/);
    expect(todo).not.toMatch(/más de \d+/i);
  });
});

describe("feed de Merchant", () => {
  const origen = { urlSitio: "https://mjbj.com.ar", nombreTienda: "Maderera Juan B. Justo" };
  const placa: ProductoParaFeed = {
    slug: "melamina-blanca",
    nombre: "Melamina blanca",
    descripcion: "Placa de melamina <blanca> & lisa.",
    marca: "Faplac",
    categoria: "Placas",
    rubro: "Melaminas",
    imagenes: ["/subidas/melamina.jpg", "https://images.unsplash.com/x?w=800&q=80"],
    aPedido: false,
    variantes: [
      { sku: "MEL-18", medida: "18 mm", precio: "45000", disponibilidad: "alto" },
      { sku: "MEL-15", medida: "15 mm", precio: "41000", disponibilidad: "sin-stock" },
      { sku: "MEL-25", medida: "25 mm", precio: null, disponibilidad: "alto" },
    ],
  };

  it("una línea por medida con precio, agrupadas por producto", () => {
    const xml = armarFeedMerchant([placa], origen);
    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml).toContain("<g:item_group_id>melamina-blanca</g:item_group_id>");
    expect(xml).toContain("<g:price>45000.00 ARS</g:price>");
    expect(xml).toContain("<g:availability>out_of_stock</g:availability>");
    expect(xml).toContain("<g:image_link>https://mjbj.com.ar/subidas/melamina.jpg</g:image_link>");
    expect(xml).toContain("<g:title>Melamina blanca 18 mm</g:title>");
    expect(xml).toContain("<g:identifier_exists>no</g:identifier_exists>");
    expect(xml).toContain("<g:product_type>Placas &gt; Melaminas</g:product_type>");
  });

  it("escapa el texto y las URLs", () => {
    const xml = armarFeedMerchant([placa], origen);
    expect(xml).toContain("&lt;blanca&gt; &amp; lisa");
    expect(xml).toContain("x?w=800&amp;q=80");
    expect(escaparXml("a\u0001b")).toBe("ab");
  });

  it("deja afuera lo que no tiene foto, y lo dice", () => {
    const xml = armarFeedMerchant([{ ...placa, imagenes: [] }], origen);
    expect(xml).not.toContain("<item>");
    expect(xml).toMatch(/Afuera: 2 sin foto, 1 medidas sin precio/);
  });

  it("no inventa la marca", () => {
    const xml = armarFeedMerchant([{ ...placa, marca: null }], origen);
    expect(xml).not.toContain("<g:brand>");
  });

  it("lo que se hace a pedido queda como pedido, no como agotado", () => {
    expect(disponibilidadMerchant("sin-stock", true)).toBe("backorder");
    expect(disponibilidadMerchant("bajo", false)).toBe("in_stock");
  });
});
