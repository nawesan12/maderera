import { after } from "next/server";
import {
  estadoWhatsapp,
  listarConversaciones,
  listarPlantillas,
  marcarLeidaSilencioso,
  obtenerConversacion,
} from "@/lib/dal/admin/whatsapp";
import { Bandeja } from "./bandeja";
import { AvisoConexion } from "./aviso-conexion";

/**
 * La bandeja, compartida por las dos formas de usarla.
 *
 * Dentro del panel convive con el resto del trabajo; en `/atencion` ocupa toda
 * la pantalla, para quien se dedica a contestar y tiene esa pestaña abierta
 * todo el día. Es la misma vista y los mismos datos: lo único que cambia es
 * cuánto alto tiene disponible.
 */
export async function VistaWhatsapp({
  chat,
  filtro,
  pantallaCompleta = false,
}: {
  chat?: string;
  filtro?: string;
  pantallaCompleta?: boolean;
}) {
  const vista =
    filtro === "sin-leer" || filtro === "cerradas" ? filtro : "todas";

  const [conversaciones, estado, plantillas] = await Promise.all([
    listarConversaciones(vista),
    estadoWhatsapp(),
    listarPlantillas(),
  ]);

  // La conversación abierta se elige por la URL, así el enlace a una charla
  // concreta se puede compartir entre el equipo y sobrevive a recargar.
  const elegida = chat ?? conversaciones[0]?.id ?? null;
  const detalle = elegida ? await obtenerConversacion(elegida) : null;

  // Abrirla es haberla leído. Va en `after()` para no demorar el render y sin
  // revalidar, porque revalidar desde acá volvería a renderizar esta misma
  // pantalla en un ciclo.
  if (detalle && detalle.noLeidos > 0) {
    after(async () => {
      await marcarLeidaSilencioso(detalle.id);
    });
  }

  return (
    <>
      {/* En pantalla completa el cartel de demostración va compacto: el alto
          que ocupa se le resta a los mensajes, que es lo que se vino a leer. */}
      <AvisoConexion estado={estado} compacto={pantallaCompleta} />

      <Bandeja
        conversaciones={conversaciones}
        detalle={detalle}
        filtro={vista}
        plantillas={plantillas}
        modoDemo={estado.proveedor === "demo"}
        pantallaCompleta={pantallaCompleta}
      />
    </>
  );
}
