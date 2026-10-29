/**
 * Golden de cortes: el plano (motor guillotina, búsqueda, fijadas), la hoja
 * de corte en el orden de la máquina, el PTX y la lista para el optimizador
 * byte a byte, la tarifa, el presupuesto, la placa, la sierra y las
 * calculadoras. Corre el TS de verdad (lib/cortes/** y lib/calculations.ts,
 * git 9a17128) sobre miles de casos al azar con semilla, más el banco de
 * scripts/benchmark-plano.ts. El Go (internal/cortes) compara exacto.
 *
 *   TZ=America/Argentina/Buenos_Aires npx tsx --tsconfig tsconfig.json scripts/golden/cortes.ts
 *
 * La zona importa para la fecha del PTX: el Go la escribe en hora argentina
 * (ver docs/go/progreso.md, tanda 11).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import {
  azarConSemilla,
  calcularPlanoDeCorte,
  leerAcomodoManual,
  superficieDeSierra,
  type PiezaAcortar,
  type PiezaFijada,
} from "../../lib/cortes/plano";
import { armarHojaDeCorte } from "../../lib/cortes/secuencia";
import { armarPtx, espesorDelMaterial, nombreDeArchivoPtx, textoPtx } from "../../lib/cortes/ptx";
import {
  armarArchivoDeCorte,
  convertirMedida,
  nombreDeArchivo,
  PERFIL_GENERICO,
  type ClaveColumna,
  type PerfilDeExportacion,
} from "../../lib/cortes/formatos";
import {
  cargoPorCorte,
  cargoPorTapacanto,
  metrosDeTapacanto,
  tarifaDeCorte,
  type TarifaDeCorte,
} from "../../lib/cortes/tarifa";
import { presupuestarCorte } from "../../lib/cortes/presupuesto";
import { fraccionDePlaca, medidaDePlaca, nombreDeLaMitad, type Mitad } from "../../lib/cortes/placa";
import { leerAnchoDeSierra } from "../../lib/cortes/sierra";
import {
  calculateBoards,
  calculateDeck,
  calculateFloor,
  calculateRoof,
  type ParametrosDeCalculo,
} from "../../lib/calculations";
import { despiecesDePrueba } from "../benchmark-plano";

if (process.env.TZ !== "America/Argentina/Buenos_Aires") {
  throw new Error("Correlo con TZ=America/Argentina/Buenos_Aires (la fecha del PTX).");
}

const DESTINO = new URL("../../backend/testdata/golden/cortes/", import.meta.url);
mkdirSync(DESTINO, { recursive: true });
const guardar = (nombre: string, datos: unknown) =>
  writeFileSync(new URL(nombre, DESTINO), gzipSync(JSON.stringify(datos) + "\n", { level: 9 }));

const azar = azarConSemilla(20261029);
const entre = (a: number, b: number) => Math.round(a + azar() * (b - a));
const uno = <T,>(xs: readonly T[]): T => xs[Math.floor(azar() * xs.length)]!;

const ETIQUETAS = [null, null, "Lateral", "Puerta, alta", 'Estante 1/2"', "Fondo ñandú", "Tapa × 2", "  doble  espacio "];
const MATERIALES = [
  "Melamina Blanca — 1830 x 2750mm — 18mm",
  "MDF 15 mm crudo",
  "Fenólico 18,5mm",
  "Placa \"especial\"; con punto y coma",
  "Enchapado Paraíso",
  "Fibro Plus 3mm, marrón",
];

function piezasAlAzar(): PiezaAcortar[] {
  const renglones = entre(1, 16);
  const piezas: PiezaAcortar[] = [];
  for (let r = 0; r < renglones; r++) {
    const t = azar();
    let largo: number;
    let ancho: number;
    if (t < 0.05) {
      largo = entre(2800, 3200); // no entra
      ancho = entre(100, 400);
    } else if (t < 0.4) {
      largo = entre(200, 2400);
      ancho = entre(80, 900);
    } else if (t < 0.6) {
      largo = Math.round(entre(300, 1200) / 5) * 5;
      ancho = largo; // cuadrada
    } else {
      largo = entre(100, 900);
      ancho = entre(50, 600);
    }
    piezas.push({
      largoMm: largo,
      anchoMm: ancho,
      cantidad: t < 0.02 ? 0 : entre(1, azar() < 0.1 ? 12 : 4),
      respetaVeta: azar() < 0.25 ? 1 : 0,
      etiqueta: uno(ETIQUETAS),
      cantoLargo: entre(0, 2),
      cantoAncho: entre(0, 2),
    });
  }
  return piezas;
}

const PLACAS = [
  [2750, 1830],
  [2600, 1830],
  [2440, 1220],
  [3050, 1220],
  [1375, 1830],
  [2750, 915],
  [1220, 1220],
];
const SIERRAS = [5, 5, 4.4, 3.2, 0.5, 10, 4];

// --- plano, hoja, PTX y lista ---
interface CasoPlano {
  datos: Parameters<typeof calcularPlanoDeCorte>[0];
  plano: unknown;
  superficies: number[];
  hoja: unknown;
  hojaError?: string;
  ptx?: string;
  trabajo?: { numero: string; cliente: string; material: string; createdAt: string };
}

const casos: CasoPlano[] = [];

function correr(datos: Parameters<typeof calcularPlanoDeCorte>[0], trabajo?: CasoPlano["trabajo"]) {
  const plano = calcularPlanoDeCorte(datos);
  const caso: CasoPlano = {
    datos,
    plano,
    superficies: plano.placas.map((p) => superficieDeSierra(p, plano.anchoSierra)),
    hoja: null,
  };
  try {
    const hoja = armarHojaDeCorte(plano);
    caso.hoja = hoja;
    if (trabajo && plano.placas.length > 0) {
      caso.trabajo = trabajo;
      caso.ptx = armarPtx(
        { ...trabajo, createdAt: new Date(trabajo.createdAt), piezas: datos.piezas },
        hoja,
      );
    }
  } catch (e) {
    caso.hojaError = (e as Error).message;
  }
  casos.push(caso);
}

// El banco del benchmark, con y sin búsqueda.
despiecesDePrueba().forEach((d, i) => {
  const piezas = d.piezas.map((p) => ({ ...p, etiqueta: null }));
  correr({ piezas, placaLargo: d.placaLargo, placaAncho: d.placaAncho, anchoSierra: 5 });
  if (i % 4 === 0) correr({ piezas, placaLargo: d.placaLargo, placaAncho: d.placaAncho, anchoSierra: 5, busqueda: false });
});

// Al azar.
for (let i = 0; i < 1500; i++) {
  const piezas = piezasAlAzar();
  const [placaLargo, placaAncho] = uno(PLACAS);
  const anchoSierra = uno(SIERRAS);
  const fijadas: PiezaFijada[] = [];
  if (azar() < 0.3) {
    const n = entre(1, 4);
    for (let k = 0; k < n; k++) {
      const indice = entre(0, piezas.length - 1);
      const f: PiezaFijada = { indice, unidad: entre(1, 3), placa: entre(1, 3) };
      if (azar() < 0.3) f.girada = azar() < 0.5;
      fijadas.push(f);
    }
  }
  const busqueda = azar() < 0.85;
  const fecha = new Date(Date.UTC(2026, entre(0, 11), entre(1, 28), entre(0, 23), entre(0, 59)));
  correr(
    {
      piezas,
      placaLargo,
      placaAncho,
      anchoSierra,
      fijadas,
      busqueda,
      ...(azar() < 0.1 ? { semilla: entre(1, 1e9) } : {}),
      ...(azar() < 0.1 ? { presupuesto: entre(1000, 200000) } : {}),
    },
    {
      numero: uno(["CRT-460", "CRT-1", "CRT-123456789", "C 1042", "X"]),
      cliente: uno(["Gómez, Juan", "Carpintería «El Roble»", "Ñoño SRL"]),
      material: uno(MATERIALES),
      createdAt: fecha.toISOString(),
    },
  );
}

// Grandes, para pasar el tope de la búsqueda.
for (let i = 0; i < 6; i++) {
  const piezas = Array.from({ length: 30 }, () => ({
    largoMm: entre(100, 800),
    anchoMm: entre(50, 400),
    cantidad: entre(10, 20),
    respetaVeta: azar() < 0.3 ? 1 : 0,
    etiqueta: null,
  }));
  correr({ piezas, placaLargo: 2750, placaAncho: 1830, anchoSierra: 4.4 });
}

// Bordes.
correr({ piezas: [], placaLargo: 2750, placaAncho: 1830 });
correr({ piezas: [{ largoMm: 100, anchoMm: 100, cantidad: 1, respetaVeta: 0, etiqueta: null }], placaLargo: 0, placaAncho: 1830 });
correr({ piezas: [{ largoMm: 2750, anchoMm: 1830, cantidad: 2, respetaVeta: 1, etiqueta: "Entera" }], placaLargo: 2750, placaAncho: 1830 });
correr({ piezas: [{ largoMm: 1830, anchoMm: 2750, cantidad: 1, respetaVeta: 0, etiqueta: null }], placaLargo: 2750, placaAncho: 1830 });
correr({ piezas: [{ largoMm: 900, anchoMm: 1830, cantidad: 3, respetaVeta: 0, etiqueta: null }], placaLargo: 2750, placaAncho: 1830, anchoSierra: 5 });

guardar("planos.json.gz", casos);

// --- leerAcomodoManual ---
const acomodos = [
  null, "", "x", "{}", "[]", "[1]", '[{"indice":0,"unidad":1,"placa":1}]',
  '[{"indice":0,"unidad":1,"placa":0}]', '[{"indice":1.5,"unidad":1,"placa":1}]',
  '[{"indice":0,"unidad":1,"placa":2,"girada":true},{"indice":"1","unidad":1,"placa":1}]',
  '[{"indice":0,"unidad":1,"placa":2,"girada":"si"}]', "[null]",
].map((crudo) => ({ crudo, fijadas: leerAcomodoManual(crudo) }));

// --- lista para el optimizador ---
const CLAVES: ClaveColumna[] = ["largo", "ancho", "cantidad", "material", "etiqueta", "veta", "cantoLargo", "cantoAncho", "numero", "cliente"];
const listas: { corte: unknown; perfil: PerfilDeExportacion; archivo: string; nombre: string }[] = [];
for (let i = 0; i < 600; i++) {
  const perfil: PerfilDeExportacion =
    i === 0
      ? PERFIL_GENERICO
      : {
          nombre: "P",
          separador: uno([";", ",", "\t", "|"]),
          conEncabezado: azar() < 0.6,
          unidad: uno(["mm", "cm", "m"] as const),
          decimal: uno([",", "."] as const),
          siNo: uno([["Sí", "No"], ["S", "N"], ["1", "0"], ["x;y", 'n"o']] as [string, string][]),
          finDeLinea: uno(["\n", "\r\n"] as const),
          columnas: Array.from({ length: entre(1, 10) }, () => {
            const clave = uno(CLAVES);
            return { clave, encabezado: uno([clave, "Medida; mm", 'Con "comillas"', "Línea\nnueva", ""]) };
          }),
        };
  const corte = {
    numero: uno(["CRT-460", "../C 1042", "_x_", "CRT 12/3"]),
    cliente: uno(["Gómez; Juan", "Ana", 'La "Casa"']),
    material: uno(MATERIALES),
    piezas: piezasAlAzar().map((p) => ({
      largoMm: azar() < 0.1 ? p.largoMm + 0.5 : p.largoMm,
      anchoMm: p.anchoMm,
      cantidad: p.cantidad,
      respetaVeta: p.respetaVeta,
      cantoLargo: p.cantoLargo ?? 0,
      cantoAncho: p.cantoAncho ?? 0,
      etiqueta: p.etiqueta ?? null,
    })),
  };
  listas.push({ corte, perfil, archivo: armarArchivoDeCorte(corte, perfil), nombre: nombreDeArchivo(corte.numero, perfil.separador) });
}
const medidas: { mm: number; unidad: "mm" | "cm" | "m"; decimal: "," | "."; texto: string }[] = [];
for (const mm of [0, 1, 9, 10, 1229, 1230, 999, 1000, 12345, 0.5, 1229.4, 7, 100]) {
  for (const unidad of ["mm", "cm", "m"] as const) {
    for (const decimal of [",", "."] as const) medidas.push({ mm, unidad, decimal, texto: convertirMedida(mm, unidad, decimal) });
  }
}

// --- tarifa y presupuesto ---
const TARIFAS: TarifaDeCorte[] = [
  { material: "Placas", priceListId: null, precioPorPasada: 1200, precioPorMetroCanto: 850.5 },
  { material: "Placas", priceListId: "may", precioPorPasada: 996, precioPorMetroCanto: 0 },
  { material: "Tableros de madera", priceListId: null, precioPorPasada: 1400, precioPorMetroCanto: 0 },
  { material: "  Fenólicos  ", priceListId: "may", precioPorPasada: 1162.33, precioPorMetroCanto: 10.1 },
  { material: "Melamína", priceListId: null, precioPorPasada: 1.005, precioPorMetroCanto: 2.675 },
];
const BUSCADOS = ["Placas", "placas", "PLACAS ", "Tableros  de Madera", "fenolicos", "Melamina", "", "Otra cosa", "Plácas"];
const tarifas: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const candidatos = Array.from({ length: entre(1, 3) }, () => uno(BUSCADOS));
  const lista = uno([null, "may", "otra"]);
  tarifas.push({ candidatos, lista, tarifa: tarifaDeCorte(TARIFAS, candidatos, lista) });
}
const cargos: unknown[] = [];
for (let i = 0; i < 1500; i++) {
  const tarifa = azar() < 0.1 ? null : uno(TARIFAS);
  const pasadas = azar() < 0.1 ? -1 : azar() * 80;
  const piezas = piezasAlAzar().map((p) => ({ ...p, cantidad: azar() < 0.05 ? -2 : p.cantidad + (azar() < 0.1 ? 0.7 : 0), cantoLargo: azar() < 0.05 ? 3 : p.cantoLargo ?? 0, cantoAncho: p.cantoAncho ?? 0 }));
  const metros = metrosDeTapacanto(piezas);
  cargos.push({
    tarifa,
    pasadas,
    piezas,
    corte: cargoPorCorte(tarifa, pasadas),
    metros,
    canto: cargoPorTapacanto(tarifa, metros),
  });
}
const presupuestos: unknown[] = [];
for (let i = 0; i < 600; i++) {
  const piezas = piezasAlAzar();
  const [placaLargo, placaAncho] = uno(PLACAS);
  const plano = calcularPlanoDeCorte({ piezas, placaLargo, placaAncho, anchoSierra: uno(SIERRAS), busqueda: azar() < 0.5 });
  const tarifa = azar() < 0.15 ? null : uno(TARIFAS);
  const precio = azar() < 0.15 ? null : uno([0, 84500, 123456.785, 99.995, 1.005]);
  const mitad = uno([null, "largo", "ancho"] as Mitad[]);
  const fraccion = fraccionDePlaca(mitad, uno([50, 55, 60, 33.3]));
  presupuestos.push({
    plano,
    tarifa,
    precio,
    piezas,
    fraccion,
    cuenta: presupuestarCorte({ plano, tarifa, precioPorPlaca: precio, piezas, fraccion }),
  });
}

// --- placa y sierra ---
const placas: unknown[] = [];
const vals = [null, 0, 2750, 1830, 2441, 1221, NaN];
for (let i = 0; i < 400; i++) {
  const args = {
    propiaLargo: uno(vals),
    propiaAncho: uno(vals),
    varianteLargo: uno(vals),
    varianteAncho: uno(vals),
    mitad: uno([null, "largo", "ancho"] as Mitad[]),
  };
  const r = medidaDePlaca(args);
  placas.push({
    args: Object.fromEntries(Object.entries(args).map(([k, v]) => [k, Number.isNaN(v) ? "NaN" : v])),
    medida: r,
    nombre: nombreDeLaMitad(args.mitad),
  });
}
const sierras = ["", "5", "3,2", "3.25", "3.24", " 4,4 ", "0.4", "0.45", "0.5", "10", "10.04", "10.05", "abc", "1e1", "2,5,1", "-3"].map((t) => ({
  texto: t,
  mm: leerAnchoDeSierra(t),
}));

// --- calculadoras ---
const PARAM: ParametrosDeCalculo = {
  mermaMachimbre: 0.2,
  factorPendiente: 0.15,
  margenSeguridad: 0.12,
  anchoSierraMm: 5,
  rindeRolloMembrana: 9,
  rindeRolloAislacion: 21.6,
  separacionTechoM: 0.6,
  separacionPisoM: 0.4,
  deck: { grandis: { largoM: 2.4, anchoM: 0.1 }, pvc: { largoM: 2.9, anchoM: 0.14 } },
};
const paramAlAzar = (): ParametrosDeCalculo =>
  azar() < 0.5
    ? PARAM
    : {
        mermaMachimbre: Math.round(azar() * 100) / 100,
        factorPendiente: Math.round(azar() * 100) / 100,
        margenSeguridad: Math.round(azar() * 1000) / 1000,
        anchoSierraMm: uno(SIERRAS),
        rindeRolloMembrana: Math.round(azar() * 2000) / 100 + 0.5,
        rindeRolloAislacion: Math.round(azar() * 3000) / 100 + 0.5,
        separacionTechoM: Math.round(azar() * 100) / 100 + 0.2,
        separacionPisoM: Math.round(azar() * 100) / 100 + 0.2,
        deck: {
          grandis: { largoM: Math.round(azar() * 400) / 100 + 1, anchoM: Math.round(azar() * 300) / 1000 + 0.05 },
          pvc: { largoM: 2.9, anchoM: azar() < 0.1 ? 0 : 0.14 },
        },
      };
const medidaM = () => (azar() < 0.3 ? entre(1, 30) : Math.round(azar() * 3000) / 100);
const calculadoras: unknown[] = [];
for (let i = 0; i < 3000; i++) {
  const p = paramAlAzar();
  const largo = medidaM();
  const ancho = medidaM();
  const tipo = uno(["pino", "saligna"] as const);
  const material = uno(["grandis", "pvc"] as const);
  const piezas = Array.from({ length: entre(0, 8) }, () => ({ ancho: entre(50, 1200), largo: entre(50, 2700), cantidad: entre(1, 10) }));
  const [pl, pa] = uno(PLACAS);
  calculadoras.push({
    p,
    largo,
    ancho,
    tipo,
    material,
    piezas,
    placaAncho: pa,
    placaLargo: pl,
    techo: calculateRoof(largo, ancho, tipo, p),
    placas: calculateBoards(piezas, pa, pl, p.anchoSierraMm, p.margenSeguridad),
    piso: calculateFloor(largo, ancho, undefined, p.separacionPisoM),
    deck: calculateDeck(largo, ancho, material, p.deck[material], p.margenSeguridad, p.separacionPisoM),
  });
}
// El caso del comentario: 13.44 / 0.24.
calculadoras.push({
  p: PARAM, largo: 4, ancho: 3, tipo: "pino", material: "grandis", piezas: [], placaAncho: 1830, placaLargo: 2750,
  techo: calculateRoof(4, 3, "pino", PARAM),
  placas: calculateBoards([], 1830, 2750, 5, 0.12),
  piso: calculateFloor(4, 3, undefined, 0.4),
  deck: calculateDeck(4, 3, "grandis", PARAM.deck.grandis, 0.12, 0.4),
});

// --- textos del PTX ---
const textos = [
  "Melamina 18mm, blanca", "Ñandú ×2", '"Comillas"', "  muchos   espacios  ", "tab\tnueva\nlínea", "€uro ☃", "ÀÉÎÕÜ çß",
  "a".repeat(80),
].map((t) => ({ texto: t, ptx: textoPtx(t), ptx25: textoPtx(t, 25) }));
const nombres = ["CRT-460", "CRT-123456789", "C 1042", "x", "ABCDEF-12", "", "123"].map((n) => ({ numero: n, nombre: nombreDeArchivoPtx(n) }));
const espesores = ["Melamina 18mm", "MDF 15 MM", "Fenólico 18,5 mm", "Fibro 3.2mm", "sin espesor", "Placa 0mm", "Viga 150mm", "x 12 mm"].map((m) => ({
  material: m,
  espesor: espesorDelMaterial(m),
}));

guardar("sueltos.json.gz", { acomodos, listas, medidas, tarifas, cargos, presupuestos, placas, sierras, calculadoras, textos, nombres, espesores });
console.log(`cortes: ${casos.length} planos, ${listas.length} listas, ${calculadoras.length} calculadoras`);
