/**
 * Siembra la base con datos mínimos de desarrollo.
 *
 * IMPORTANTE: los precios y las cantidades de stock son INVENTADOS. Sirven para
 * probar que el sistema funciona de punta a punta, no para mostrarle al cliente.
 * Se reemplazan por completo cuando llegue la exportación de Quality Software.
 *
 * Las sucursales, las categorías y los nombres de producto sí son reales.
 *
 * Uso: npm run db:seed
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, sql } from "drizzle-orm";
import * as schema from "./schema";

const {
  branches,
  categories,
  inventory,
  priceListItems,
  priceLists,
  productImages,
  productVariants,
  products,
  supplierMovements,
  suppliers,
} = schema;

type UnitOfSale = (typeof schema.unitOfSale.enumValues)[number];

interface VariantSeed {
  sku: string;
  label: string;
  largoMm?: number;
  anchoMm?: number;
  espesorMm?: number;
  material?: string;
  color?: string;
  /** Precio de lista general, en pesos. Placeholder. */
  precio: number;
  /** Descuento de la lista profesional sobre el general, 0-1. Placeholder. */
  descuentoProfesional?: number;
  stockCentral: number;
  stockAserradero: number;
  minCentral?: number;
  minAserradero?: number;
}

interface ProductSeed {
  slug: string;
  name: string;
  subcategory?: string;
  description: string;
  brand?: string;
  unit: UnitOfSale;
  featured?: boolean;
  image: string;
  variants: VariantSeed[];
}

interface CategorySeed {
  slug: string;
  name: string;
  description: string;
  icon: string;
  image: string;
  products: ProductSeed[];
}

const IMG = {
  madera: "https://images.unsplash.com/photo-1520333789090-1afc82db536a?w=800&q=80",
  taller: "https://images.unsplash.com/photo-1504148455328-c376907d081c?w=800&q=80",
  piso: "https://images.unsplash.com/photo-1615873968403-89e068629265?w=800&q=80",
} as const;

/**
 * Portada de cada categoría, una distinta por rubro.
 *
 * Todas verificadas: varias URLs de Unsplash que parecían válidas devolvían
 * 404, y una portada rota deja la tarjeta en gris. Son provisorias hasta que
 * lleguen las fotos del cliente.
 */
const PORTADA: Record<string, string> = {
  techos: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&q=80",
  placas: "https://images.unsplash.com/photo-1541123437800-1bb1317badc2?w=800&q=80",
  pisos: "https://images.unsplash.com/photo-1615873968403-89e068629265?w=800&q=80",
  molduras: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=800&q=80",
  ferreteria: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80",
  "decks-y-escaleras": "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80",
  "construccion-en-seco": "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=800&q=80",
  cubiertas: "https://images.unsplash.com/photo-1632759145351-1d592919f522?w=800&q=80",
};

const CATALOGO: CategorySeed[] = [
  {
    slug: "techos",
    name: "Techos",
    description: "Tirantes, machimbres, aislantes y complementos para techos",
    icon: "Home",
    image: IMG.madera,
    products: [
      {
        slug: "tirante-pino-tratado",
        name: "Tirante Pino Tratado",
        subcategory: "Tirantería",
        description:
          "Tirante de pino tratado en autoclave, ideal para estructuras de techo. Alta resistencia y durabilidad.",
        unit: "unidad",
        featured: true,
        image: IMG.madera,
        variants: [
          { sku: "TEC-TIR-PIN-2436", label: '2" x 4" x 3.60m', largoMm: 3600, anchoMm: 100, espesorMm: 50, material: "Pino Tratado", precio: 28500, stockCentral: 40, stockAserradero: 120, minCentral: 10, minAserradero: 25 },
          { sku: "TEC-TIR-PIN-2536", label: '2" x 5" x 3.60m', largoMm: 3600, anchoMm: 125, espesorMm: 50, material: "Pino Tratado", precio: 35200, stockCentral: 22, stockAserradero: 85, minCentral: 10, minAserradero: 25 },
          { sku: "TEC-TIR-PIN-2642", label: '2" x 6" x 4.20m', largoMm: 4200, anchoMm: 150, espesorMm: 50, material: "Pino Tratado", precio: 49800, stockCentral: 8, stockAserradero: 60, minCentral: 10, minAserradero: 25 },
        ],
      },
      {
        slug: "tirante-saligna",
        name: "Tirante Saligna",
        subcategory: "Tirantería",
        description:
          "Tirante de eucalipto saligna, mayor dureza y resistencia estructural para luces grandes.",
        unit: "unidad",
        image: IMG.madera,
        variants: [
          { sku: "TEC-TIR-SAL-3642", label: '3" x 6" x 4.20m', largoMm: 4200, anchoMm: 150, espesorMm: 75, material: "Saligna", precio: 68400, stockCentral: 0, stockAserradero: 34, minCentral: 6, minAserradero: 15 },
          { sku: "TEC-TIR-SAL-3648", label: '3" x 6" x 4.80m', largoMm: 4800, anchoMm: 150, espesorMm: 75, material: "Saligna", precio: 78900, stockCentral: 0, stockAserradero: 18, minCentral: 6, minAserradero: 15 },
        ],
      },
      {
        slug: "machimbre-pino",
        name: "Machimbre Pino",
        subcategory: "Machimbres",
        description:
          "Machimbre de pino cepillado para cielorrasos y techos a la vista. Se vende por metro cuadrado.",
        unit: "metro_cuadrado",
        featured: true,
        image: IMG.madera,
        variants: [
          { sku: "TEC-MAC-PIN-1204", label: '1/2" x 4"', anchoMm: 100, espesorMm: 12, material: "Pino", precio: 18700, stockCentral: 180, stockAserradero: 450, minCentral: 50, minAserradero: 100 },
          { sku: "TEC-MAC-PIN-3406", label: '3/4" x 6"', anchoMm: 150, espesorMm: 19, material: "Pino", precio: 26400, stockCentral: 95, stockAserradero: 240, minCentral: 50, minAserradero: 100 },
        ],
      },
      {
        slug: "membrana-asfaltica",
        name: "Membrana Asfáltica",
        subcategory: "Aislaciones",
        description:
          "Membrana asfáltica con aluminio, 4mm de espesor. Rollo de 1m x 10m para impermeabilización.",
        unit: "rollo",
        image: IMG.madera,
        variants: [
          { sku: "TEC-MEM-ASF-4010", label: "4mm x 1m x 10m", largoMm: 10000, anchoMm: 1000, espesorMm: 4, precio: 84500, stockCentral: 26, stockAserradero: 14, minCentral: 8, minAserradero: 8 },
        ],
      },
    ],
  },
  {
    slug: "placas",
    name: "Placas",
    description: "Melaminas, MDF, fenólicos, terciados y más",
    icon: "Layers",
    image: IMG.madera,
    products: [
      {
        slug: "melamina-blanca",
        name: "Melamina Blanca",
        subcategory: "Melaminas",
        description:
          "Placa de aglomerado revestida en melamina blanca. Servicio de corte a medida disponible.",
        unit: "placa",
        featured: true,
        image: IMG.madera,
        variants: [
          { sku: "PLA-MEL-BLA-18", label: "1830 x 2600mm — 18mm", largoMm: 2600, anchoMm: 1830, espesorMm: 18, color: "Blanco", precio: 96500, descuentoProfesional: 0.18, stockCentral: 64, stockAserradero: 12, minCentral: 20, minAserradero: 10 },
          { sku: "PLA-MEL-BLA-15", label: "1830 x 2600mm — 15mm", largoMm: 2600, anchoMm: 1830, espesorMm: 15, color: "Blanco", precio: 82300, descuentoProfesional: 0.18, stockCentral: 38, stockAserradero: 6, minCentral: 20, minAserradero: 10 },
        ],
      },
      {
        slug: "mdf",
        name: "MDF",
        subcategory: "MDF",
        description:
          "Fibrofácil de densidad media, superficie lisa ideal para pintar y para trabajos de detalle.",
        unit: "placa",
        image: IMG.madera,
        variants: [
          { sku: "PLA-MDF-003", label: "1830 x 2600mm — 3mm", largoMm: 2600, anchoMm: 1830, espesorMm: 3, precio: 31200, descuentoProfesional: 0.15, stockCentral: 120, stockAserradero: 0, minCentral: 30, minAserradero: 0 },
          { sku: "PLA-MDF-018", label: "1830 x 2600mm — 18mm", largoMm: 2600, anchoMm: 1830, espesorMm: 18, precio: 88700, descuentoProfesional: 0.15, stockCentral: 45, stockAserradero: 0, minCentral: 30, minAserradero: 0 },
        ],
      },
      {
        slug: "fenolico",
        name: "Fenólico",
        subcategory: "Fenólicos",
        description:
          "Placa fenólica para encofrados y uso exterior. Alta resistencia a la humedad.",
        unit: "placa",
        featured: true,
        image: IMG.madera,
        variants: [
          { sku: "PLA-FEN-018", label: "1220 x 2440mm — 18mm", largoMm: 2440, anchoMm: 1220, espesorMm: 18, precio: 134000, descuentoProfesional: 0.2, stockCentral: 30, stockAserradero: 44, minCentral: 12, minAserradero: 12 },
          { sku: "PLA-FEN-015", label: "1220 x 2440mm — 15mm", largoMm: 2440, anchoMm: 1220, espesorMm: 15, precio: 118500, descuentoProfesional: 0.2, stockCentral: 18, stockAserradero: 21, minCentral: 12, minAserradero: 12 },
          { sku: "PLA-FEN-012", label: "1220 x 2440mm — 12mm", largoMm: 2440, anchoMm: 1220, espesorMm: 12, precio: 99800, descuentoProfesional: 0.2, stockCentral: 9, stockAserradero: 15, minCentral: 12, minAserradero: 12 },
        ],
      },
    ],
  },
  {
    slug: "pisos",
    name: "Pisos",
    description: "Pisos melamínicos Decno Flooring y más",
    icon: "Grid3X3",
    image: IMG.piso,
    products: [
      {
        slug: "piso-melaminico-roble-natural",
        name: "Piso Melamínico Roble Natural",
        subcategory: "Pisos flotantes",
        description:
          "Piso flotante melamínico con sistema click, tono roble natural. Caja de 2.39 m².",
        brand: "Decno Flooring",
        unit: "metro_cuadrado",
        featured: true,
        image: IMG.piso,
        variants: [
          { sku: "PIS-DEC-ROB-08", label: "8mm — AC4", espesorMm: 8, color: "Roble Natural", precio: 41800, descuentoProfesional: 0.12, stockCentral: 220, stockAserradero: 0, minCentral: 60, minAserradero: 0 },
        ],
      },
      {
        slug: "piso-melaminico-nogal",
        name: "Piso Melamínico Nogal",
        subcategory: "Pisos flotantes",
        description:
          "Piso flotante melamínico tono nogal oscuro, resistente al tránsito intenso.",
        brand: "Decno Flooring",
        unit: "metro_cuadrado",
        image: IMG.piso,
        variants: [
          { sku: "PIS-DEC-NOG-08", label: "8mm — AC4", espesorMm: 8, color: "Nogal", precio: 43600, descuentoProfesional: 0.12, stockCentral: 85, stockAserradero: 0, minCentral: 60, minAserradero: 0 },
        ],
      },
      {
        slug: "zocalo-mdf-laqueado",
        name: "Zócalo MDF Laqueado",
        subcategory: "Terminaciones",
        description:
          "Zócalo de MDF laqueado blanco, tira de 2.40m. Terminación para piso flotante.",
        unit: "metro_lineal",
        image: IMG.piso,
        variants: [
          { sku: "PIS-ZOC-MDF-07", label: "7cm x 2.40m", largoMm: 2400, anchoMm: 70, color: "Blanco", precio: 8900, stockCentral: 340, stockAserradero: 60, minCentral: 80, minAserradero: 40 },
        ],
      },
    ],
  },
  {
    slug: "molduras",
    name: "Molduras",
    description: "Molduras de pino finger joint — Marca Moldava",
    icon: "Minus",
    image: IMG.taller,
    products: [
      {
        slug: "moldura-zocalo-moldava",
        name: "Moldura Zócalo Moldava",
        subcategory: "Zócalos",
        description:
          "Zócalo de pino finger joint marca propia Moldava, listo para pintar. Distribución nacional.",
        brand: "Moldava",
        unit: "metro_lineal",
        featured: true,
        image: IMG.taller,
        variants: [
          { sku: "MOL-ZOC-070", label: "7cm x 2.40m", largoMm: 2400, anchoMm: 70, material: "Pino Finger Joint", precio: 7400, descuentoProfesional: 0.22, stockCentral: 480, stockAserradero: 120, minCentral: 100, minAserradero: 50 },
          { sku: "MOL-ZOC-100", label: "10cm x 2.40m", largoMm: 2400, anchoMm: 100, material: "Pino Finger Joint", precio: 9800, descuentoProfesional: 0.22, stockCentral: 260, stockAserradero: 80, minCentral: 100, minAserradero: 50 },
        ],
      },
      {
        slug: "moldura-marco-puerta-moldava",
        name: "Moldura Marco Puerta Moldava",
        subcategory: "Marcos",
        description:
          "Juego de marco para puerta en pino finger joint Moldava. Incluye las tres piezas.",
        brand: "Moldava",
        unit: "juego",
        image: IMG.taller,
        variants: [
          { sku: "MOL-MAR-STD", label: "Juego estándar 80cm", material: "Pino Finger Joint", precio: 32500, descuentoProfesional: 0.22, stockCentral: 45, stockAserradero: 18, minCentral: 15, minAserradero: 10 },
        ],
      },
      {
        slug: "moldura-cornisa-moldava",
        name: "Moldura Cornisa Moldava",
        subcategory: "Cornisas",
        description:
          "Cornisa decorativa de pino finger joint para unión de pared y cielorraso.",
        brand: "Moldava",
        unit: "metro_lineal",
        image: IMG.taller,
        variants: [
          { sku: "MOL-COR-045", label: "4.5cm x 2.40m", largoMm: 2400, anchoMm: 45, material: "Pino Finger Joint", precio: 6200, descuentoProfesional: 0.22, stockCentral: 180, stockAserradero: 40, minCentral: 60, minAserradero: 30 },
        ],
      },
    ],
  },
  {
    slug: "ferreteria",
    name: "Ferretería",
    description: "Herrajes, accesorios, lacas y complementos",
    icon: "Wrench",
    image: IMG.taller,
    products: [
      {
        slug: "bisagra-cierre-suave",
        name: "Bisagra Cierre Suave",
        subcategory: "Herrajes",
        description:
          "Bisagra de cazoleta con cierre suave para muebles de cocina y placares.",
        unit: "unidad",
        image: IMG.taller,
        variants: [
          { sku: "FER-BIS-035", label: "35mm codo 0", precio: 4200, descuentoProfesional: 0.25, stockCentral: 620, stockAserradero: 0, minCentral: 150, minAserradero: 0 },
        ],
      },
      {
        slug: "corredera-telescopica",
        name: "Corredera Telescópica",
        subcategory: "Herrajes",
        description:
          "Par de correderas telescópicas de acero con rulemanes, extracción total.",
        unit: "par",
        image: IMG.taller,
        variants: [
          { sku: "FER-COR-450", label: "45cm", largoMm: 450, precio: 12800, descuentoProfesional: 0.25, stockCentral: 140, stockAserradero: 0, minCentral: 40, minAserradero: 0 },
          { sku: "FER-COR-500", label: "50cm", largoMm: 500, precio: 14200, descuentoProfesional: 0.25, stockCentral: 95, stockAserradero: 0, minCentral: 40, minAserradero: 0 },
        ],
      },
      {
        slug: "laca-poliuretanica",
        name: "Laca Poliuretánica",
        subcategory: "Pinturas y lacas",
        description:
          "Laca poliuretánica de dos componentes para terminación de madera. Alta resistencia.",
        unit: "litro",
        image: IMG.taller,
        variants: [
          { sku: "FER-LAC-POL-4", label: "4 litros — Brillante", precio: 68900, stockCentral: 32, stockAserradero: 12, minCentral: 10, minAserradero: 6 },
          { sku: "FER-LAC-POL-1", label: "1 litro — Satinado", precio: 21400, stockCentral: 58, stockAserradero: 20, minCentral: 10, minAserradero: 6 },
        ],
      },
    ],
  },
  {
    slug: "decks-y-escaleras",
    name: "Decks y Escaleras",
    description: "Decks de madera y PVC, escaleras a medida",
    icon: "Layers",
    image: IMG.madera,
    products: [
      {
        slug: "deck-grandis",
        name: "Deck Grandis",
        subcategory: "Decks",
        description:
          "Tabla de deck en eucalipto grandis tratado, ranurada antideslizante. Se vende por metro cuadrado.",
        unit: "metro_cuadrado",
        featured: true,
        image: IMG.madera,
        variants: [
          { sku: "DEC-GRA-2490", label: '1" x 4" x 2.40m', largoMm: 2400, anchoMm: 100, espesorMm: 25, material: "Eucalipto Grandis", precio: 74500, descuentoProfesional: 0.15, stockCentral: 0, stockAserradero: 180, minCentral: 0, minAserradero: 40 },
        ],
      },
      {
        slug: "deck-pvc",
        name: "Deck PVC",
        subcategory: "Decks",
        description:
          "Deck sintético de PVC, sin mantenimiento, resistente a la intemperie marina.",
        unit: "metro_cuadrado",
        image: IMG.madera,
        variants: [
          { sku: "DEC-PVC-GRI", label: "Gris — 2.90m", largoMm: 2900, anchoMm: 140, espesorMm: 22, color: "Gris", precio: 118000, descuentoProfesional: 0.15, stockCentral: 0, stockAserradero: 65, minCentral: 0, minAserradero: 20 },
          { sku: "DEC-PVC-MAD", label: "Símil madera — 2.90m", largoMm: 2900, anchoMm: 140, espesorMm: 22, color: "Símil madera", precio: 124500, descuentoProfesional: 0.15, stockCentral: 0, stockAserradero: 28, minCentral: 0, minAserradero: 20 },
        ],
      },
      {
        slug: "escalera-pino-a-medida",
        name: "Escalera Pino a Medida",
        subcategory: "Escaleras",
        description:
          "Escalera de pino fabricada a medida en el aserradero. Requiere presupuesto previo.",
        unit: "unidad",
        image: IMG.madera,
        variants: [
          { sku: "DEC-ESC-PIN-MED", label: "A medida — consultar", material: "Pino", precio: 0, stockCentral: 0, stockAserradero: 0, minCentral: 0, minAserradero: 0 },
        ],
      },
    ],
  },
  {
    slug: "construccion-en-seco",
    name: "Construcción en Seco",
    description: "Placas de yeso, perfilería metálica, aislantes y accesorios",
    icon: "Grid3X3",
    image: IMG.taller,
    products: [
      {
        slug: "placa-de-yeso",
        name: "Placa de Yeso",
        subcategory: "Placas",
        description:
          "Placa de yeso para tabiques y cielorrasos interiores. Versión estándar y resistente a la humedad.",
        unit: "placa",
        featured: true,
        image: IMG.taller,
        variants: [
          { sku: "CSE-YES-STD-125", label: "Estándar 1200 x 2400mm — 12.5mm", largoMm: 2400, anchoMm: 1200, espesorMm: 12, precio: 28900, descuentoProfesional: 0.18, stockCentral: 140, stockAserradero: 60, minCentral: 40, minAserradero: 20 },
          { sku: "CSE-YES-RH-125", label: "Resistente humedad 1200 x 2400mm — 12.5mm", largoMm: 2400, anchoMm: 1200, espesorMm: 12, precio: 38400, descuentoProfesional: 0.18, stockCentral: 62, stockAserradero: 25, minCentral: 40, minAserradero: 20 },
        ],
      },
      {
        slug: "perfil-montante",
        name: "Perfil Montante",
        subcategory: "Perfilería",
        description: "Perfil montante galvanizado para estructura de tabiques.",
        unit: "unidad",
        image: IMG.taller,
        variants: [
          { sku: "CSE-PER-MON-069", label: "69mm x 2.60m", largoMm: 2600, anchoMm: 69, precio: 11200, descuentoProfesional: 0.18, stockCentral: 280, stockAserradero: 90, minCentral: 80, minAserradero: 40 },
          { sku: "CSE-PER-MON-035", label: "35mm x 2.60m", largoMm: 2600, anchoMm: 35, precio: 8600, descuentoProfesional: 0.18, stockCentral: 190, stockAserradero: 70, minCentral: 80, minAserradero: 40 },
        ],
      },
      {
        slug: "lana-de-vidrio",
        name: "Lana de Vidrio",
        subcategory: "Aislantes",
        description:
          "Rollo de lana de vidrio para aislación térmica y acústica. Cubre 21.6 m².",
        unit: "rollo",
        image: IMG.taller,
        variants: [
          { sku: "CSE-LAN-050", label: "50mm — 1.2m x 18m", largoMm: 18000, anchoMm: 1200, espesorMm: 50, precio: 92700, stockCentral: 18, stockAserradero: 30, minCentral: 6, minAserradero: 10 },
        ],
      },
    ],
  },
  {
    slug: "cubiertas",
    name: "Cubiertas",
    description: "Chapas, tejas y cubiertas metálicas",
    icon: "Home",
    image: IMG.madera,
    products: [
      {
        slug: "curvin-tejado-metalico",
        name: "Curvin Tejado Metálico",
        subcategory: "Tejados metálicos",
        description:
          "Chapa con perfil de teja, terminación color. Liviana y de colocación rápida.",
        brand: "Curvin",
        unit: "metro_cuadrado",
        featured: true,
        image: IMG.madera,
        variants: [
          { sku: "CUB-CUR-ROJ", label: "Rojo teja", color: "Rojo", precio: 46800, descuentoProfesional: 0.14, stockCentral: 0, stockAserradero: 120, minCentral: 0, minAserradero: 30 },
          { sku: "CUB-CUR-NEG", label: "Negro", color: "Negro", precio: 46800, descuentoProfesional: 0.14, stockCentral: 0, stockAserradero: 45, minCentral: 0, minAserradero: 30 },
        ],
      },
      {
        slug: "chapa-acanalada-galvanizada",
        name: "Chapa Acanalada Galvanizada",
        subcategory: "Chapas",
        description:
          "Chapa acanalada galvanizada calibre 25, para cubiertas y cerramientos.",
        unit: "metro_cuadrado",
        image: IMG.madera,
        variants: [
          { sku: "CUB-CHA-C25", label: "Calibre 25 — 1.10m ancho útil", anchoMm: 1100, precio: 32400, descuentoProfesional: 0.14, stockCentral: 0, stockAserradero: 210, minCentral: 0, minAserradero: 50 },
        ],
      },
      {
        slug: "tornillo-autoperforante-cubierta",
        name: "Tornillo Autoperforante para Cubierta",
        subcategory: "Accesorios",
        description:
          "Tornillo autoperforante con arandela de neoprene para fijación de chapa.",
        unit: "unidad",
        image: IMG.taller,
        variants: [
          { sku: "CUB-TOR-AUT-063", label: '#12 x 2.1/2"', precio: 380, stockCentral: 2400, stockAserradero: 3800, minCentral: 500, minAserradero: 800 },
        ],
      },
    ],
  },
];

const SUCURSALES = [
  {
    slug: "casa-central",
    name: "Casa Central",
    address: "Av. Juan B. Justo 4153, Mar del Plata",
    phone: "(0223) 474-3328",
    whatsapp: "+542235903118",
    email: "info@mjbj.com.ar",
    hours: "Lun a Vie 8:00-16:00 · Sáb 8:00-12:00",
    servicios: [
      "Servicio de corte de placas a medida con precisión",
      "Amplio stock de molduras y listonería Moldava",
      "Fenólicos, tablas y puntales para obra",
      "Exhibición de vestidores, placares y muebles de cocina",
      "Asesoramiento personalizado para tu proyecto",
      "Melaminas, MDF y terciados con servicio de fraccionamiento",
    ].join("\n"),
    destacados: ["Showroom de muebles", "Corte CNC", "Retiro en sucursal"].join("\n"),
    sortOrder: 0,
  },
  {
    slug: "aserradero",
    name: "Aserradero",
    address: "Canosa 61, Mar del Plata",
    phone: "(0223) 483-0535",
    whatsapp: "+542235060817",
    email: "info@aserradero.mjbj.com.ar",
    hours: "Lun a Vie 8:00-16:00 · Sáb 8:00-12:00",
    servicios: [
      "Planta de fabricación con tecnología moderna",
      "Stock permanente de techos, escaleras y decks",
      "Machimbres en pino, saligna y grandis",
      "Molduras marca Moldava — producción propia",
      "Ferretería: lacas, diluyentes, selladores y más",
      "Maderas en bruto y elaboradas a medida",
    ].join("\n"),
    destacados: ["Fábrica propia", "Madera a medida", "Ferretería completa"].join("\n"),
    sortOrder: 1,
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Falta DATABASE_URL. Copiá .env.example a .env.local.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema, casing: "snake_case" });

  console.log("Limpiando tablas de catálogo…");

  /*
   * Los perfiles se guardan y se reponen.
   *
   * `TRUNCATE ... CASCADE` sobre las listas de precios arrastra a `profiles`,
   * porque tiene una FK a ellas. El efecto era que **correr la siembra dejaba
   * al administrador sin acceso al panel**: el usuario seguía existiendo y su
   * rol de staff no, así que entraba y lo mandaba al sitio público sin decir
   * por qué. Se descubrió así, después de sembrar.
   *
   * La lista de precios sí se pierde a propósito —se está regenerando— pero el
   * rol y la ficha vuelven tal cual estaban.
   */
  const perfilesPrevios = await db.execute<{
    user_id: string;
    role: string;
    staff_role: string | null;
    razon_social: string | null;
    cuit: string | null;
    condicion_iva: string;
    telefono: string | null;
    rubro: string | null;
    notas: string | null;
  }>(sql`SELECT * FROM profiles`);

  await db.execute(sql`
    TRUNCATE TABLE
      ${priceListItems}, ${inventory}, ${productImages},
      ${productVariants}, ${products}, ${categories},
      ${priceLists}, ${branches}
    RESTART IDENTITY CASCADE
  `);

  for (const perfil of perfilesPrevios.rows) {
    await db.execute(sql`
      INSERT INTO profiles (user_id, role, staff_role, razon_social, cuit,
                            condicion_iva, telefono, rubro, notas)
      VALUES (${perfil.user_id}, ${perfil.role}::user_role,
              ${perfil.staff_role}::staff_role, ${perfil.razon_social},
              ${perfil.cuit}, ${perfil.condicion_iva}::condicion_iva,
              ${perfil.telefono}, ${perfil.rubro}, ${perfil.notas})
      ON CONFLICT DO NOTHING
    `);
  }

  if (perfilesPrevios.rows.length > 0) {
    console.log(`  ${perfilesPrevios.rows.length} perfiles conservados`);
  }

  console.log("Sucursales…");
  const branchRows = await db.insert(branches).values(SUCURSALES).returning();
  const central = branchRows.find((b) => b.slug === "casa-central")!;
  const aserradero = branchRows.find((b) => b.slug === "aserradero")!;

  console.log("Listas de precios…");
  const [listaGeneral, listaProfesional] = await db
    .insert(priceLists)
    .values([
      { slug: "general", name: "Lista general", isDefault: true },
      { slug: "profesional", name: "Lista profesional", isDefault: false },
    ])
    .returning();

  let totalProductos = 0;
  let totalVariantes = 0;

  for (const [i, cat] of CATALOGO.entries()) {
    const [categoria] = await db
      .insert(categories)
      .values({
        slug: cat.slug,
        name: cat.name,
        description: cat.description,
        icon: cat.icon,
        image: PORTADA[cat.slug] ?? cat.image,
        sortOrder: i,
      })
      .returning();

    for (const [j, prod] of cat.products.entries()) {
      const [producto] = await db
        .insert(products)
        .values({
          slug: prod.slug,
          name: prod.name,
          categoryId: categoria.id,
          subcategory: prod.subcategory,
          description: prod.description,
          brand: prod.brand,
          unit: prod.unit,
          featured: prod.featured ?? false,
        })
        .returning();
      totalProductos++;

      await db.insert(productImages).values({
        productId: producto.id,
        url: prod.image,
        alt: prod.name,
        sortOrder: 0,
      });

      for (const [k, v] of prod.variants.entries()) {
        const [variante] = await db
          .insert(productVariants)
          .values({
            productId: producto.id,
            sku: v.sku,
            label: v.label,
            largoMm: v.largoMm,
            anchoMm: v.anchoMm,
            espesorMm: v.espesorMm,
            material: v.material,
            color: v.color,
            sortOrder: k,
          })
          .returning();
        totalVariantes++;

        const precioProfesional =
          v.precio * (1 - (v.descuentoProfesional ?? 0.1));

        await db.insert(priceListItems).values([
          {
            priceListId: listaGeneral.id,
            variantId: variante.id,
            price: v.precio.toFixed(2),
          },
          {
            priceListId: listaProfesional.id,
            variantId: variante.id,
            price: precioProfesional.toFixed(2),
          },
        ]);

        await db.insert(inventory).values([
          {
            variantId: variante.id,
            branchId: central.id,
            qty: v.stockCentral,
            minQty: v.minCentral ?? 0,
          },
          {
            variantId: variante.id,
            branchId: aserradero.id,
            qty: v.stockAserradero,
            minQty: v.minAserradero ?? 0,
          },
        ]);
      }

      process.stdout.write(
        `  ${cat.name} · ${prod.name} (${prod.variants.length} variantes)\n`,
      );
      void j;
    }
  }

  /*
   * Proveedores de demostración.
   *
   * Sin proveedores el módulo de compras se ve vacío y no se puede mostrar
   * nada. Son los rubros reales de una maderera: aserradero, tableros,
   * ferretería y adhesivos.
   */
  console.log("Proveedores…");

  const PROVEEDORES = [
    {
      nombre: "Aserradero El Ombú",
      razonSocial: "El Ombú S.R.L.",
      cuit: "30-71234567-4",
      rubro: "Madera aserrada",
      contacto: "Raúl Giménez",
      telefono: "0223 495-2210",
      diasPago: 30,
    },
    {
      nombre: "Tableros del Sur",
      razonSocial: "Tableros del Sur S.A.",
      cuit: "30-70998877-1",
      rubro: "Melamina y MDF",
      contacto: "Vanesa Ferrari",
      telefono: "011 4750-3300",
      diasPago: 45,
    },
    {
      nombre: "Ferretería Industrial Costa",
      cuit: "20-24567890-3",
      rubro: "Herrajes y tornillería",
      contacto: "Daniel Costa",
      telefono: "0223 474-1188",
      diasPago: 15,
    },
    {
      nombre: "Adhesivos Marplatense",
      razonSocial: "Adhesivos Marplatense S.R.L.",
      cuit: "30-71455566-9",
      rubro: "Colas y selladores",
      contacto: "Silvia Pereyra",
      telefono: "0223 480-9040",
      diasPago: 0,
    },
  ];

  for (const p of PROVEEDORES) {
    /*
     * Sembrar de nuevo no puede duplicar la lista.
     *
     * `onConflictDoNothing` no alcanza: el único índice único de proveedores es
     * el del código del sistema anterior, que en los de demostración es nulo,
     * así que cada corrida insertaba cuatro filas más. Se busca por nombre, que
     * es lo que hace única a la ficha en esta lista inventada.
     */
    const [existente] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.nombre, p.nombre))
      .limit(1);

    if (existente) continue;

    const [creado] = await db
      .insert(suppliers)
      .values(p)
      .returning({ id: suppliers.id });

    if (!creado) continue;

    // Una factura vieja y un pago parcial, para que la cuenta no arranque en
    // cero y el saldo de la pantalla signifique algo.
    const monto = 180_000 + Math.round(Math.random() * 900_000);
    await db.insert(supplierMovements).values([
      {
        supplierId: creado.id,
        tipo: "factura" as const,
        monto: monto.toFixed(2),
        referencia: `0003-${String(1200 + Math.round(Math.random() * 80)).padStart(8, "0")}`,
        detalle: "Compra de mercadería",
      },
      {
        supplierId: creado.id,
        tipo: "pago" as const,
        monto: (-Math.round(monto * 0.6)).toFixed(2),
        detalle: "Pago a cuenta por transferencia",
      },
    ]);
  }

  console.log(
    `\nListo: ${CATALOGO.length} categorías, ${totalProductos} productos, ${totalVariantes} variantes, 2 sucursales, 2 listas de precios.`,
  );
  console.log(
    "Recordá que los precios y el stock son inventados, para desarrollo.",
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
