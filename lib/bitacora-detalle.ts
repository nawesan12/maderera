import { formatearImporte } from "@/lib/formato";

/**
 * Los renglones de «antes → después» que guarda el detalle de una entrada de
 * la bitácora. La lista del proveedor anota cada SKU con su precio de antes
 * y el nuevo, y la pantalla no lo mostraba: el cambio quedaba invisible
 * (mes 23). Solo esas formas; el resto del detalle sigue sin mostrarse.
 */
export function renglonesDelDetalle(detalle: string | null): string[] {
  if (!detalle) return [];
  let d: unknown;
  try {
    d = JSON.parse(detalle);
  } catch {
    return [];
  }
  if (!d || typeof d !== "object") return [];
  const o = d as Record<string, unknown>;
  const valor = (v: unknown) => {
    if (v === null || v === undefined || v === "") return "—";
    const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? formatearImporte(n) : String(v);
  };
  if (Array.isArray(o.cambios)) {
    return o.cambios
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => `${c.sku ? `${String(c.sku)}: ` : ""}${valor(c.antes)} → ${valor(c.despues)}`);
  }
  if ("antes" in o && ("despues" in o || "oferta" in o)) {
    return [`${valor(o.antes)} → ${valor(o.despues ?? o.oferta)}`];
  }
  return [];
}
