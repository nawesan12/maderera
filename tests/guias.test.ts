import { describe, expect, it } from "vitest";
import { buscarEnGuias, listarGuias, obtenerGuia } from "@/lib/guias";

describe("guías por puesto", () => {
  it("el vendedor no ve Compras, Cerrar el mes, El sitio ni Precios, y sí Cobranza", async () => {
    const slugs = (await listarGuias("vendedor")).map((g) => g.slug);
    for (const ajena of ["compras", "cierre-del-mes", "sitio", "precios"]) expect(slugs).not.toContain(ajena);
    expect(slugs).toContain("cobranza");
    // El admin las ve todas.
    expect((await listarGuias("admin")).length).toBeGreaterThan(slugs.length);
  });

  it("«Si algo sale mal» no manda al vendedor a Bitácora ni a Avisos", async () => {
    const guia = await obtenerGuia("si-algo-sale-mal", "vendedor");
    expect(guia).not.toBeNull();
    expect(guia!.markdown).not.toMatch(/Bitácora|En \*Avisos\*/);
    expect(guia!.markdown).toMatch(/cheque/);
    expect(guia!.markdown).not.toMatch(/<!--/);
    const delAdmin = await obtenerGuia("si-algo-sale-mal", "admin");
    expect(delAdmin!.markdown).toMatch(/Bitácora/);
  });

  it("una guía de otro puesto no se abre", async () => {
    expect(await obtenerGuia("compras", "vendedor")).toBeNull();
  });

  it("la guía del aserradero no trae lo del mostrador", async () => {
    const guia = await obtenerGuia("si-algo-sale-mal", "aserradero");
    expect(guia!.markdown).not.toMatch(/Devolver|Bitácora/);
  });
});

describe("buscar en las guías", () => {
  it("busca cada palabra: «cheque rechazado» encuentra las de cheques", async () => {
    const r = await buscarEnGuias("cheque rechazado", "vendedor");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.guia.slug).toBe("cobranza");
  });

  it("las palabras de relleno no cuentan", async () => {
    expect(await buscarEnGuias("de la")).toEqual([]);
  });
});

describe("el mapa de guías del Proxy", () => {
  it("coincide con los archivos de docs/GUIAS", async () => {
    const { PARA_DE_CADA_GUIA, guiaVisible } = await import("@/lib/guias-para");
    const todas = await listarGuias(null);
    expect(Object.keys(PARA_DE_CADA_GUIA).sort()).toEqual(todas.map((g) => g.slug).sort());
    for (const g of todas) expect(PARA_DE_CADA_GUIA[g.slug] ?? null).toEqual(g.para);
    expect(guiaVisible("compras", "vendedor")).toBe(false);
    expect(guiaVisible("compras", "admin")).toBe(true);
    expect(guiaVisible("no-existe", "admin")).toBe(false);
    expect(guiaVisible("primeros-pasos", "aserradero")).toBe(true);
  });
});
