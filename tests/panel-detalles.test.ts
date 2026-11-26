import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

/** Comité final: detalles del panel a 390 px y la jerarquía de botones. */
describe("detalles del panel", () => {
  it("en Presupuestos cada «·» va pegado a su dato", () => {
    const lista = leer("app/admin/presupuestos/page.tsx");
    expect(lista).not.toMatch(/<span aria-hidden="true">·<\/span>/);
    expect(lista).toContain('<span key={i} className="whitespace-nowrap">');
  });

  it("el despiece del corte baja de renglón y el total sigue a su columna", () => {
    const ficha = leer("app/admin/cortes/[id]/page.tsx");
    expect(ficha).toMatch(/<div className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-4">\s*<h2 className="text-base font-medium">Despiece<\/h2>/);
    expect(ficha).toMatch(/hidden px-4 py-4 text-right text-base font-medium sm:table-cell/);
  });

  it("el inicio del depósito titula como el resto del inicio", () => {
    const deposito = leer("components/admin/inicio-deposito.tsx");
    expect(deposito).toContain('<h2 className="flex items-center gap-2.5 text-[19px] font-bold tracking-tight">');
    expect(deposito).toContain("wood-divider w-8");
    // El «·» pegado al título: título y cifra en el mismo span, fuera del gap.
    expect(deposito).toMatch(/<span>\s*\{titulo\}\s*\{total > 0 && <span className="[^"]*tabular-nums[^"]*"> · \{total\}<\/span>\}\s*<\/span>/);
    expect(deposito).not.toMatch(/className="tabular [^"]*"> · \{total\}/);
  });

  it("en Precios «Ajustar precios» manda y los ajustes van un escalón abajo", () => {
    expect(leer("app/admin/precios/dialogo-ajuste.tsx")).toMatch(/<DialogTrigger className="[^"]*bg-accion/);
    const pagina = leer("app/admin/precios/page.tsx");
    for (const ruta of ["formas-de-pago", "listas"]) {
      const enlace = pagina.slice(pagina.indexOf(`href="/admin/precios/${ruta}"`));
      expect(enlace.slice(0, enlace.indexOf(">")), ruta).not.toMatch(/\bborder\b/);
    }
    const formas = pagina.slice(pagina.indexOf('href="/admin/precios/formas-de-pago"'), pagina.indexOf("Formas de pago\n"));
    expect(formas).toContain("<CreditCard");
    expect(formas).not.toContain("<Percent");
  });
});
