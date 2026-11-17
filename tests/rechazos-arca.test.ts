import { describe, expect, it } from "vitest";
import { motivosDeRechazo } from "@/lib/fiscal/rechazos-arca";

describe("motivosDeRechazo", () => {
  it("traduce por código y conserva el texto original", () => {
    const [m] = motivosDeRechazo(
      "[10016] El numero o fecha del comprobante no se corresponde con el proximo a autorizar. Consultar metodo FECompUltimoAutorizado.",
    );
    expect(m.codigo).toBe("10016");
    expect(m.queHacer).toMatch(/no es el siguiente/);
    expect(m.original).toMatch(/^\[10016\]/);
  });

  it("separa varios motivos y reconoce por palabras un código desconocido", () => {
    const ms = motivosDeRechazo(
      "[99999] El campo DocNro es invalido · [88888] ImpTotal no coincide",
    );
    expect(ms).toHaveLength(2);
    expect(ms[0].queHacer).toMatch(/CUIT o documento/);
    expect(ms[1].queHacer).toMatch(/importes no cierran/);
  });

  it("sin código ni palabras conocidas da un consejo general", () => {
    const [m] = motivosDeRechazo("Algo raro pasó");
    expect(m.codigo).toBeNull();
    expect(m.queHacer).toMatch(/quien mantiene el sistema/);
  });

  it("el aviso propio de cuando falta el certificado no se confunde con un rechazo", () => {
    const [m] = motivosDeRechazo(
      "Emitido sin autorización de ARCA. El comprobante no tiene valor fiscal hasta que se cargue el certificado y se lo reenvíe.",
    );
    expect(m.queHacer).toMatch(/falta conectar/);
  });

  it("vacío no da nada", () => {
    expect(motivosDeRechazo(null)).toEqual([]);
    expect(motivosDeRechazo("  ")).toEqual([]);
  });
});
