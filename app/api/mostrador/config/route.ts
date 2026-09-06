import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";
import { ajustesDelSitio } from "@/lib/dal/contenido";
import { escalasDePago } from "@/lib/dal/descuentos-pago";
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
    const [sucursales, emisor, ajustes, escalas] = await Promise.all([
      listarSucursalesPublicas(),
      obtenerConfiguracionFiscal(),
      ajustesDelSitio(),
      escalasDePago(),
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
      /*
       * Los descuentos por forma de pago viajan acá para que el mostrador los
       * aplique también sin conexión. El servidor los vuelve a calcular
       * cuando la venta sube, así que una copia vieja en la caja no puede
       * fijar un descuento que ya no existe: lo peor que pasa es que la
       * pantalla muestre un número y el sistema corrija después, que es lo
       * mismo que ya pasa con el precio.
       */
      escalasDePago: escalas,
    };
  });
}
