import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { SENAL_ESTADO } from "@/lib/senal-navegador";

/**
 * La señal que hace que el encabezado sepa quién mira (mes simulado, M2S3-094
 * y M2S2-059): quien tenía la sesión abierta sin la señal veía «Ingresar» y
 * «Estos son los precios de público» en el sitio, hasta pasar por Mi cuenta.
 */
function pedido(ruta: string, cookies: Record<string, string> = {}) {
  const r = new NextRequest(new URL(ruta, "http://localhost"));
  for (const [k, v] of Object.entries(cookies)) r.cookies.set(k, v);
  return r;
}

describe("la señal en el sitio público", () => {
  it("con sesión y sin señal, la prende en la respuesta y en el pedido", async () => {
    const salida = await proxy(pedido("/catalogo/mdf", { "better-auth.session_token": "x" }));
    expect(salida.cookies.get(SENAL_ESTADO)?.value).toBe("1");
    expect(salida.headers.get("x-middleware-request-cookie") ?? salida.headers.get("x-middleware-override-headers")).toBeTruthy();
    expect(salida.headers.get("location")).toBeNull();
  });

  it("sin sesión no hace nada ni manda al ingreso", async () => {
    const salida = await proxy(pedido("/eventos/taller"));
    expect(salida.cookies.get(SENAL_ESTADO)).toBeUndefined();
    expect(salida.headers.get("location")).toBeNull();
  });

  it("con la señal puesta no la vuelve a mandar", async () => {
    const salida = await proxy(pedido("/", { "better-auth.session_token": "x", [SENAL_ESTADO]: "abc" }));
    expect(salida.cookies.get(SENAL_ESTADO)).toBeUndefined();
  });

  it("Mi cuenta sin sesión sigue mandando al ingreso", async () => {
    const salida = await proxy(pedido("/mi-cuenta/pedidos"));
    expect(salida.headers.get("location")).toContain("/ingresar?volver=%2Fmi-cuenta%2Fpedidos");
  });
});
