import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { ajustesDelSitio } from "@/lib/dal/contenido";
import { conStaff } from "../guardia";

/**
 * Lo que el mostrador necesita saber del negocio y casi nunca cambia.
 *
 * Sucursales, datos del emisor para el ticket y el número de WhatsApp. Va
 * aparte del catálogo porque tiene otra frecuencia: el catálogo se refresca
 * cada diez minutos, esto una vez por jornada.
 */
export async function GET() {
  return conStaff(async () => {
    const [sucursales, emisor, ajustes] = await Promise.all([
      listarSucursalesPublicas(),
      obtenerConfiguracionFiscal(),
      ajustesDelSitio(),
    ]);

    return {
      sucursales: sucursales.map((s) => ({
        id: s.id,
        slug: s.slug,
        nombre: s.nombre,
        direccion: s.direccion,
        telefono: s.telefono,
      })),
      emisor: {
        razonSocial: emisor?.razonSocial ?? "Maderera Juan B. Justo",
        nombreFantasia: emisor?.nombreFantasia ?? null,
        cuit: emisor?.cuit ?? null,
        domicilio: emisor?.domicilio ?? null,
      },
      whatsapp: ajustes.whatsapp_principal ?? null,
    };
  });
}
