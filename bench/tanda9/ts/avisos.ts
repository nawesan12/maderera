// datosDeSucursal de lib/whatsapp/avisos.ts (git 9a17128), lo único que el
// DAL de la bandeja usaba de ese módulo.
import { sucursalPublicada, SUCURSALES } from "@/lib/sucursales";

export function datosDeSucursal(nombre: string | null, slug: string | null) {
  const publicada = (slug && sucursalPublicada(slug)) || SUCURSALES.find((s) => s.nombre === nombre) || SUCURSALES[0];
  return {
    sucursal: publicada ? `${publicada.nombre}, ${publicada.direccion.replace(/, Mar del Plata$/, "")}` : nombre ?? "la sucursal",
    horario: publicada?.horario ?? "",
  };
}
