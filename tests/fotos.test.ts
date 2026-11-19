import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

/**
 * Las fotos del sitio.
 *
 * La portada salió con una foto de Unsplash+ que tenía la marca de agua
 * repetida encima, sin licencia: lo primero que veía cualquiera y un reclamo
 * esperando. Las de Unsplash+ se reconocen por el nombre (`premium_photo-…`),
 * así que ninguna puede estar en `public/fotos`. Y cada `/fotos/…` que nombra
 * el código tiene que existir: una foto borrada no rompe el build, deja un
 * hueco gris en la página.
 */
const RAIZ = join(__dirname, "..");
const CARPETAS = ["app", "components", "lib", "backend/internal", "backend/db"];

function archivos(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta));
    // Las pruebas de Go inventan rutas a propósito (`/fotos/t.jpg`).
    else if (/\.(tsx?|go|sql)$/.test(nombre) && !nombre.endsWith("_test.go")) {
      salida.push(ruta);
    }
  }
  return salida;
}

describe("fotos del sitio", () => {
  it("no hay fotos de Unsplash+ en public/fotos", () => {
    const premium = readdirSync(join(RAIZ, "public/fotos")).filter((n) =>
      n.startsWith("premium_"),
    );
    expect(premium).toEqual([]);
  });

  // Vale para /fotos/ (las de banco que quedan) y /sitio/ (las portadas
  // propias que nombra la base): una errata en una migración deja una
  // tarjeta gris sin romper nada.
  it("cada /fotos/… y /sitio/… nombrada en el código existe", () => {
    const faltan: string[] = [];
    for (const carpeta of CARPETAS) {
      for (const archivo of archivos(join(RAIZ, carpeta))) {
        const texto = readFileSync(archivo, "utf8");
        // `@/lib/sitio/…` son las importadas: viven en lib/sitio.
        for (const m of texto.matchAll(/(@\/lib)?\/(fotos|sitio)\/([\w.-]+\.(?:jpe?g|png|webp|avif))/g)) {
          const ruta = m[1] ? join(RAIZ, "lib", m[2], m[3]) : join(RAIZ, "public", m[2], m[3]);
          if (!existsSync(ruta)) {
            faltan.push(`${archivo.slice(RAIZ.length + 1)}: ${m[0]}`);
          }
        }
      }
    }
    expect(faltan).toEqual([]);
  });

  it("ninguna foto de public/fotos quedó sin usar", () => {
    const todo = CARPETAS.flatMap((c) => archivos(join(RAIZ, c)).map((a) => readFileSync(a, "utf8"))).join("\n");
    const sueltas = readdirSync(join(RAIZ, "public/fotos")).filter((n) => !todo.includes(n));
    expect(sueltas).toEqual([]);
  });

  /*
   * Las fotos propias salen de scripts/fotos/procesar.mjs: sRGB y sin
   * metadatos (las de la cámara traen modelo, fecha y a veces GPS).
   */
  it("las fotos propias van sin metadatos y en sRGB", async () => {
    const propias = [
      ...readdirSync(join(RAIZ, "public/sitio")).map((n) => join(RAIZ, "public/sitio", n)),
      ...readdirSync(join(RAIZ, "lib/sitio"))
        .filter((n) => n.endsWith(".webp"))
        .map((n) => join(RAIZ, "lib/sitio", n)),
    ];
    expect(propias.length).toBeGreaterThan(0);
    for (const ruta of propias) {
      const m = await sharp(ruta).metadata();
      expect(m.format, ruta).toBe("webp");
      expect(m.exif ?? m.icc ?? m.xmp, ruta).toBeUndefined();
      expect(["srgb", "b-w"], ruta).toContain(m.space);
      expect(Math.max(m.width ?? 0, m.height ?? 0), ruta).toBeLessThanOrEqual(2400);
    }
  });
});
