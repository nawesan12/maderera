import { afterEach, describe, expect, it, vi } from "vitest";
import { avisosDeArranque, problemasDeArranque } from "@/lib/entorno";
import { sitioIndexable } from "@/lib/seo";

/**
 * Lo que decide si el servidor propio arranca y si el sitio se indexa.
 *
 * Se prueba porque falla en silencio: sin `APP_URL` el pago se cobra igual y
 * el cliente vuelve a `localhost`; con `APP_ENV` mal leído, una copia de
 * prueba termina en Google compitiendo con el sitio real.
 */

describe("arranque fuera de Vercel", () => {
  const produccion = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

  it("no arranca sin APP_URL", () => {
    expect(problemasDeArranque(produccion)).toHaveLength(1);
  });

  it("no arranca con una APP_URL que no es URL", () => {
    expect(problemasDeArranque({ ...produccion, APP_URL: "mjbj.ar" })).toHaveLength(1);
  });

  it("arranca con APP_URL", () => {
    expect(problemasDeArranque({ ...produccion, APP_URL: "https://mjbj.ar" })).toEqual([]);
  });

  it("en Vercel y en desarrollo no exige nada", () => {
    expect(problemasDeArranque({ ...produccion, VERCEL: "1" })).toEqual([]);
    expect(
      problemasDeArranque({ NODE_ENV: "development" } as NodeJS.ProcessEnv),
    ).toEqual([]);
  });

  it("avisa si SEO_INDEXAR y APP_ENV no están declarados, sin frenar", () => {
    expect(avisosDeArranque({ ...produccion, APP_URL: "https://mjbj.ar" })).toHaveLength(2);
    expect(
      avisosDeArranque({
        ...produccion,
        APP_ENV: "production",
        SEO_INDEXAR: "si",
      }),
    ).toEqual([]);
  });
});

describe("indexación", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("APP_ENV distinto de production se comporta como una vista previa", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("APP_ENV", "staging");
    expect(sitioIndexable()).toBe(false);
  });

  it("APP_ENV=production se indexa salvo que SEO_INDEXAR diga que no", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("SEO_INDEXAR", "si");
    expect(sitioIndexable()).toBe(true);

    vi.stubEnv("SEO_INDEXAR", "no");
    expect(sitioIndexable()).toBe(false);
  });

  it("en Vercel manda VERCEL_ENV aunque APP_ENV diga otra cosa", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("APP_ENV", "production");
    expect(sitioIndexable()).toBe(false);
  });
});
