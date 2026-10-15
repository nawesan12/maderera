import { after } from "next/server";
import {
  contarBandeja,
  estadoWhatsapp,
  gastoParaLaBandeja,
  listarConversaciones,
  listarPlantillas,
  marcarLeidaSilencioso,
  obtenerConversacion,
  personalDeLaBandeja,
  requireBandeja,
  type FiltroBandeja,
} from "@/lib/dal/admin/whatsapp";
import { proveedorWhatsapp } from "@/lib/whatsapp";
import { Bandeja } from "./bandeja";
import { AvisoConexion } from "./aviso-conexion";

const FILTROS: FiltroBandeja[] = ["todas", "sin-leer", "mias", "sin-asignar", "resueltas"];

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
  const usuario = await requireBandeja();
  // «cerradas» era el nombre viejo de «resueltas»: los enlaces guardados siguen andando.
  const pedido = filtro === "cerradas" ? "resueltas" : filtro;
  const vista: FiltroBandeja = FILTROS.includes(pedido as FiltroBandeja) ? (pedido as FiltroBandeja) : "todas";

  const [conversaciones, estado, plantillas, contadores, personal, gasto] = await Promise.all([
    listarConversaciones(vista),
    estadoWhatsapp(),
    listarPlantillas(),
    contarBandeja(),
    personalDeLaBandeja(),
    gastoParaLaBandeja(),
  ]);

  // La conversación abierta se elige por la URL, así el enlace a una charla
  // concreta se puede compartir entre el equipo y sobrevive a recargar.
  const elegida = chat ?? conversaciones[0]?.id ?? null;
  const detalle = elegida ? await obtenerConversacion(elegida) : null;

  // Abrirla es haberla leído: se ponen en cero los no leídos y se le avisa a
  // WhatsApp, que le muestra al cliente los dos tildes azules. En `after()`
  // para no demorar el render y sin revalidar, que volvería a renderizar esta
  // misma pantalla en un ciclo.
  if (detalle && detalle.noLeidos > 0) {
    after(async () => {
      const ultimo = await marcarLeidaSilencioso(detalle.id);
      if (ultimo) await proveedorWhatsapp().marcarLeido(ultimo);
    });
  }

  return (
    <>
      {/* En pantalla completa el cartel va compacto: el alto que ocupa se le
          resta a los mensajes, que es lo que se vino a leer. */}
      <AvisoConexion estado={estado} compacto={pantallaCompleta} esAdmin={usuario.staffRole === "admin"} />

      <Bandeja
        conversaciones={conversaciones}
        detalle={detalle}
        filtro={vista}
        contadores={contadores}
        plantillas={plantillas}
        personal={personal}
        usuarioId={usuario.userId}
        modoDemo={estado.proveedor === "demo"}
        pantallaCompleta={pantallaCompleta}
        gasto={gasto}
      />
    </>
  );
}
