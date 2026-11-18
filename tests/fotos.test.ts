import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

  it("cada /fotos/… nombrada en el código existe", () => {
    const faltan: string[] = [];
    for (const carpeta of CARPETAS) {
      for (const archivo of archivos(join(RAIZ, carpeta))) {
        const texto = readFileSync(archivo, "utf8");
        for (const m of texto.matchAll(/\/fotos\/([\w.-]+\.(?:jpe?g|png|webp|avif))/g)) {
          if (!existsSync(join(RAIZ, "public/fotos", m[1]))) {
            faltan.push(`${archivo.slice(RAIZ.length + 1)}: ${m[1]}`);
          }
        }
      }
    }
    expect(faltan).toEqual([]);
  });
});
