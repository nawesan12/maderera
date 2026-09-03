import { describe, expect, it } from "vitest";
import { CLAVES_DE_LOCK } from "@/lib/dal/numeracion-ventas";

/**
 * El defecto que este archivo existe para evitar.
 *
 * Dos cajas cobrando al mismo tiempo leían el mismo `max(numero)` y pedían el
 * mismo `PED-n`. El índice único de `orders.numero` impedía el número repetido
 * —eso siempre funcionó— pero lo hacía **abortando la segunda venta con un
 * error crudo**, con el cliente enfrente y la mercadería sobre el mostrador. El
 * arreglo es tomar un lock sobre la serie, como ya hacía la numeración fiscal.
 *
 * Lo que se fija acá no es el lock —eso necesita dos transacciones de verdad y
 * no se prueba con vitest— sino **la elección de las claves**, que es la parte
 * que se puede romper en silencio.
 *
 * Los locks consultivos de Postgres comparten un único espacio de 64 bits. Si
 * alguien elige para otra cosa un número que ya usa la numeración, las dos
 * partes se esperan entre sí sin tener nada que ver. No corrompe datos: hace
 * esperar, a veces mucho, y es dificilísimo de encontrar.
 */
describe("claves de lock de la numeración", () => {
  /** `hashtext()` de Postgres devuelve un `int4`. */
  const TOPE_HASHTEXT = 2_147_483_647;

  /** `claveDeLock()` de `lib/fiscal/numeracion.ts`: (hash % 1e6) * 1e4 + pv. */
  const TOPE_FISCAL = 9_999_999_999;

  /** El literal de `lib/entregas/index.ts` para la serie de remitos. */
  const CLAVE_REMITOS = 918_273_645;

  const claves = Object.entries(CLAVES_DE_LOCK);

  it.each(claves)(
    "%s queda fuera del rango de hashtext, que usan ventas, stock y eventos",
    (_nombre, clave) => {
      expect(clave).toBeGreaterThan(TOPE_HASHTEXT);
    },
  );

  it.each(claves)(
    "%s queda fuera del rango de la numeración fiscal",
    (_nombre, clave) => {
      expect(clave).toBeGreaterThan(TOPE_FISCAL);
    },
  );

  it.each(claves)("%s no es la clave de los remitos", (_nombre, clave) => {
    expect(clave).not.toBe(CLAVE_REMITOS);
  });

  it("no repite clave entre series: pedidos y presupuestos no se esperan", () => {
    const valores = claves.map(([, clave]) => clave);
    expect(new Set(valores).size).toBe(valores.length);
  });

  it("entra en un bigint con signo, que es lo que Postgres acepta", () => {
    for (const [, clave] of claves) {
      expect(Number.isSafeInteger(clave)).toBe(true);
      expect(clave).toBeLessThan(2 ** 63 - 1);
    }
  });
});
