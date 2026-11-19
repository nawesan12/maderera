#!/usr/bin/env node
/**
 * Prepara las fotos del Drive de la clienta para el sitio y la biblioteca.
 *
 *   node scripts/fotos/procesar.mjs <carpeta del drive> <salida>
 *
 * Correlo desde la raíz del repo y con la carpeta descargada en otro lado: la
 * descarga es material de afuera y no tiene que quedar en el camino de
 * resolución de módulos. Qué sale y adónde va, en docs/fotos.md.
 *
 * Por cada foto: la gira según la cámara, la pasa a sRGB, la recorta y la
 * guarda en WebP **sin metadatos** (sin EXIF ni GPS ni perfil: lo que sale de
 * sharp por omisión, y se comprueba al final). Una por vez: las muestras de
 * Fibraplac llegan a 115 MP, unos 350 MB decodificadas.
 *
 * Al final arma `hoja.jpg` para mirarlas antes de copiarlas: la foto de
 * producto con el cuadrado que muestra el teléfono, y cada banda como queda en
 * el encabezado a 1440×300 y a 390×330.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import sharp from "sharp";
import { SELECCION } from "./seleccion.mjs";

const LADO_MINIMO = 1600; // la regla de la biblioteca
const TOPE_BIBLIOTECA = 8 << 20; // topeImagen de backend/internal/subidas

sharp.concurrency(1);
sharp.cache(false);

const args = process.argv.slice(2);
// --solo <texto>: procesa solo las de destino que lo contengan (para retocar un
// recorte sin esperar las sesenta). La hoja se arma igual con todo lo que haya.
const iSolo = args.indexOf("--solo");
const solo = iSolo >= 0 ? args.splice(iSolo, 2)[1] : null;
const [drive, salida] = args;
if (!drive || !salida) {
  console.error("Uso: node scripts/fotos/procesar.mjs <carpeta del drive> <salida>");
  process.exit(2);
}
const temporal = mkdtempSync(join(tmpdir(), "mjbj-fotos-"));

/** El archivo de origen, ya legible por sharp. */
function fuente(origen) {
  if (typeof origen === "object") {
    // Una foto de adentro de un PDF: la imagen más grande de esa página.
    const dir = join(temporal, `pdf-${origen.pagina}`);
    mkdirSync(dir, { recursive: true });
    execFileSync("pdfimages", ["-f", String(origen.pagina), "-l", String(origen.pagina), "-j", join(drive, origen.pdf), join(dir, "i")]);
    const jpgs = readdirSync(dir).filter((n) => n.endsWith(".jpg")).map((n) => join(dir, n));
    if (jpgs.length === 0) throw new Error(`la página ${origen.pagina} no tiene fotos JPEG`);
    return jpgs.sort((a, b) => statSync(b).size - statSync(a).size)[0];
  }
  return join(drive, origen);
}

/**
 * sharp 0.35 no abre los TIFF con compresión deflate (BARILOCHE, DUNA,
 * MOSCATEL) ni el VERSATO.jpg, que es un TIFF: pasan antes por sips.
 */
async function abrir(ruta) {
  try {
    const m = await sharp(ruta, { limitInputPixels: 2e8 }).metadata();
    return { ruta, m };
  } catch {
    const png = join(temporal, basename(ruta) + ".png");
    execFileSync("sips", ["-s", "format", "png", ruta, "--out", png], { stdio: "ignore" });
    return { ruta: png, m: await sharp(png, { limitInputPixels: 2e8 }).metadata() };
  }
}

/** El recorte más grande con la proporción pedida, achicado por `zoom` y centrado en `foco`. */
export function recorte(w, h, ancho, alto, foco = [0.5, 0.5], zoom = 1) {
  const a = ancho / alto;
  let cw, ch;
  if (w / h > a) {
    ch = h / zoom;
    cw = ch * a;
  } else {
    cw = w / zoom;
    ch = cw / a;
  }
  cw = Math.round(cw);
  ch = Math.round(ch);
  const left = Math.round(Math.min(Math.max(foco[0] * w - cw / 2, 0), w - cw));
  const top = Math.round(Math.min(Math.max(foco[1] * h - ch / 2, 0), h - ch));
  return { left, top, width: cw, height: ch };
}

async function procesar(s) {
  const { ruta, m } = await abrir(fuente(s.origen));
  // Las medidas ya giradas: con orientación 5–8 ancho y alto se invierten.
  const girada = (m.orientation ?? 1) >= 5;
  const w = girada ? m.height : m.width;
  const h = girada ? m.width : m.height;
  const aBiblioteca = s.destino.startsWith("biblioteca/") || s.destino.startsWith("sin-codigo/");
  if (aBiblioteca && Math.max(w, h) < LADO_MINIMO) {
    throw new Error(`${s.destino}: el original mide ${w}×${h}, menos de ${LADO_MINIMO} px`);
  }

  let region;
  if (s.pixeles) {
    region = {
      left: Math.round(Math.min(Math.max(s.pixeles[0] - s.ancho / 2, 0), w - s.ancho)),
      top: Math.round(Math.min(Math.max(s.pixeles[1] - s.alto / 2, 0), h - s.alto)),
      width: s.ancho,
      height: s.alto,
    };
  } else {
    region = recorte(w, h, s.ancho, s.alto, s.foco, s.zoom);
    if (region.width < s.ancho * 0.75) {
      console.warn(`  ojo: ${s.destino} agranda ${(s.ancho / region.width).toFixed(2)}×`);
    }
  }

  let img = sharp(ruta, { limitInputPixels: 2e8 }).rotate().extract(region);
  if (!s.pixeles) img = img.resize(s.ancho, s.alto, { kernel: "lanczos3" });
  // A sRGB con el perfil que trae (las del celular vienen en Display P3, los
  // blancos de Fibraplac en CMYK).
  img = img.toColourspace("srgb");
  if (s.ajuste === "galpon") {
    // Tubos quemados y piso brillante: se bajan las luces altas sin oscurecer
    // las sombras, y un poco de saturación que el celular exageró.
    img = img.linear(0.9, 8).modulate({ saturation: 0.92 });
  }
  if (s.ajuste === "bn") img = img.grayscale();

  const archivo = join(salida, s.destino);
  mkdirSync(dirname(archivo), { recursive: true });
  const datos = await img.webp({ quality: s.calidad ?? 85, effort: 5, smartSubsample: true }).toBuffer();

  // Un color liso no es una foto de producto: no dice qué es ni cómo es el canto.
  if (aBiblioteca) {
    const st = await sharp(datos).stats();
    if (st.channels.slice(0, 3).every((c) => c.stdev < 2)) {
      throw new Error(`${s.destino}: es un color liso (desvío < 2): va como dato del color, no como foto`);
    }
    if (datos.length > TOPE_BIBLIOTECA) throw new Error(`${s.destino}: pesa más de 8 MB`);
  }
  writeFileSync(archivo, datos);

  const fin = await sharp(datos).metadata();
  if (fin.exif || fin.icc || fin.xmp || fin.iptc) throw new Error(`${s.destino}: quedaron metadatos`);
  return { destino: s.destino, ancho: fin.width, alto: fin.height, bytes: datos.length, tipo: s.tipo ?? "foto" };
}

/* ------------------------------- la hoja ------------------------------- */

const CELDA = 420;

async function miniatura(r) {
  const archivo = join(salida, r.destino);
  const alto = Math.round((CELDA * r.alto) / r.ancho);
  const capas = [];
  if (r.tipo === "producto") {
    // El cuadrado central: lo que ve el teléfono (aspect-square, una columna).
    const lado = alto;
    const x = Math.round((CELDA - lado) / 2);
    capas.push({
      input: Buffer.from(
        `<svg width="${CELDA}" height="${alto}"><rect x="${x + 1}" y="1" width="${lado - 2}" height="${lado - 2}" fill="none" stroke="#EC7D38" stroke-width="3"/></svg>`,
      ),
      top: 0,
      left: 0,
    });
  }
  let base = await sharp(archivo).resize(CELDA, alto).composite(capas).jpeg().toBuffer();
  if (r.tipo === "banda") {
    // Como queda en EncabezadoPublico: escritorio 1440×300 con el degradado,
    // teléfono 390×330 con la capa al 85 %.
    const escritorioCompleto = await sharp(await sharp(archivo).resize(1440, 300, { fit: "cover" }).toBuffer())
      .composite([
        {
          input: Buffer.from(
            `<svg width="1440" height="300"><defs><linearGradient id="g"><stop offset="0" stop-color="#26231f" stop-opacity=".92"/><stop offset=".55" stop-color="#26231f" stop-opacity=".7"/><stop offset="1" stop-color="#26231f" stop-opacity=".45"/></linearGradient></defs><rect width="1440" height="300" fill="url(#g)"/></svg>`,
          ),
        },
      ])
      .toBuffer();
    const escritorio = await sharp(escritorioCompleto).resize(CELDA, Math.round((CELDA * 300) / 1440)).toBuffer();
    const telefonoCompleto = await sharp(await sharp(archivo).resize(390, 330, { fit: "cover" }).toBuffer())
      .composite([{ input: Buffer.from(`<svg width="390" height="330"><rect width="390" height="330" fill="#26231f" fill-opacity=".85"/></svg>`) }])
      .toBuffer();
    const telefono = await sharp(telefonoCompleto).resize(150, 127).toBuffer();
    const altoTotal = alto + 88 + 130;
    base = await sharp({ create: { width: CELDA, height: altoTotal, channels: 3, background: "#ffffff" } })
      .composite([
        { input: base, top: 0, left: 0 },
        { input: escritorio, top: alto + 4, left: 0 },
        { input: telefono, top: alto + 92, left: 0 },
      ])
      .jpeg()
      .toBuffer();
  }
  const meta = await sharp(base).metadata();
  const rotulo = Buffer.from(
    `<svg width="${CELDA}" height="22"><rect width="${CELDA}" height="22" fill="#26231f"/><text x="6" y="16" font-family="Helvetica" font-size="13" fill="#fff">${r.destino.replace(/&/g, "&amp;")} · ${r.ancho}×${r.alto} · ${Math.round(r.bytes / 1024)} KB</text></svg>`,
  );
  return sharp({ create: { width: CELDA, height: meta.height + 22, channels: 3, background: "#ffffff" } })
    .composite([
      { input: rotulo, top: 0, left: 0 },
      { input: base, top: 22, left: 0 },
    ])
    .jpeg()
    .toBuffer();
}

async function hoja(resultados, nombre) {
  if (resultados.length === 0) return;
  const cols = 4;
  const minis = [];
  for (const r of resultados) minis.push(await miniatura(r));
  const altos = await Promise.all(minis.map(async (b) => (await sharp(b).metadata()).height));
  const filas = [];
  for (let i = 0; i < minis.length; i += cols) filas.push(Math.max(...altos.slice(i, i + cols)));
  const capas = minis.map((input, i) => ({
    input,
    left: (i % cols) * (CELDA + 8),
    top: filas.slice(0, Math.floor(i / cols)).reduce((a, b) => a + b + 8, 0),
  }));
  await sharp({
    create: { width: cols * (CELDA + 8), height: filas.reduce((a, b) => a + b + 8, 0), channels: 3, background: "#e5e5e5" },
  })
    .composite(capas)
    .jpeg({ quality: 80 })
    .toFile(join(salida, nombre));
}

/* -------------------------------- correr -------------------------------- */

const previos = existsSync(join(salida, "manifiesto.json"))
  ? JSON.parse(readFileSync(join(salida, "manifiesto.json"), "utf8"))
  : [];
const resultados = solo ? previos.filter((r) => !r.destino.includes(solo)) : [];
let fallas = 0;
for (const s of SELECCION.filter((x) => !solo || x.destino.includes(solo))) {
  try {
    const r = await procesar(s);
    resultados.push(r);
    console.log(`${r.destino.padEnd(52)} ${String(r.ancho).padStart(4)}×${String(r.alto).padEnd(4)} ${Math.round(r.bytes / 1024)} KB`);
  } catch (e) {
    fallas++;
    console.error(`FALLA ${s.destino}: ${e.message}`);
  }
}
const orden = SELECCION.map((x) => x.destino);
resultados.sort((a, b) => orden.indexOf(a.destino) - orden.indexOf(b.destino));
writeFileSync(join(salida, "manifiesto.json"), JSON.stringify(resultados, null, 2));
await hoja(resultados.filter((r) => !r.destino.startsWith("sin-codigo/")), "hoja.jpg");
await hoja(resultados.filter((r) => r.destino.startsWith("sin-codigo/")), "hoja-sin-codigo.jpg");
rmSync(temporal, { recursive: true, force: true });

for (const carpeta of ["estatico", "sitio", "biblioteca", "sin-codigo"]) {
  const dir = join(salida, carpeta);
  if (!existsSync(dir)) continue;
  const total = readdirSync(dir).reduce((a, n) => a + statSync(join(dir, n)).size, 0);
  console.log(`${carpeta}: ${readdirSync(dir).length} archivos, ${(total / 1024 / 1024).toFixed(2)} MB`);
}
if (fallas) {
  console.error(`${fallas} con falla`);
  process.exit(1);
}
