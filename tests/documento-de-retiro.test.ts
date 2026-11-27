import { describe, expect, it } from "vitest";
import { DOCUMENTO_INVALIDO, FALTA_DOCUMENTO, revisarDocumentoDeRetiro } from "@/lib/entregas/documento";

// Espejo de entregas.RevisarDocumento: el remito y «Marcar entregado» lo
// revisan antes de preguntar «sin cobrar» o de cobrar.
describe("revisarDocumentoDeRetiro", () => {
  it("vacío es que falta", () => {
    expect(revisarDocumentoDeRetiro("  ")).toBe(FALTA_DOCUMENTO);
  });
  it("un DNI o un CUIT, con puntos y guiones", () => {
    expect(revisarDocumentoDeRetiro("20.111.222")).toBeNull();
    expect(revisarDocumentoDeRetiro("30-71234567-1")).toBeNull();
    expect(revisarDocumentoDeRetiro("AB123456")).toBeNull();
  });
  it("lo que no es un documento", () => {
    expect(revisarDocumentoDeRetiro("123")).toBe(DOCUMENTO_INVALIDO);
    expect(revisarDocumentoDeRetiro("123456789012")).toBe(DOCUMENTO_INVALIDO);
    expect(revisarDocumentoDeRetiro("12/345")).toBe(DOCUMENTO_INVALIDO);
  });
});
