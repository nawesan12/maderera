import { abrirBandeja, requireBandeja } from "@/lib/dal/admin/whatsapp";
import { Bandeja } from "./bandeja";
import { AvisoConexion } from "./aviso-conexion";
import { ajuste } from "@/lib/dal/contenido";

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
  // Todo en un pedido a la API de Go (backend/internal/whatsapp), que además
  // normaliza el filtro («cerradas» era el nombre viejo de «resueltas») y,
  // si la conversación abierta tenía mensajes sin leer, los pone en cero y le
  // avisa a WhatsApp (los dos tildes azules del lado del cliente). La
  // conversación abierta se elige por la URL, así el enlace a una charla
  // concreta se puede compartir entre el equipo y sobrevive a recargar.
  const [{ conversaciones, estado, plantillas, contadores, personal, gasto, mensajes, detalle, filtro: vista }, bot] = await Promise.all([
    abrirBandeja(filtro, chat),
    ajuste("whatsapp_bot", "no"),
  ]);

  return (
    <>
      {/* En pantalla completa el cartel va compacto: el alto que ocupa se le
          resta a los mensajes, que es lo que se vino a leer. En el teléfono,
          con una conversación abierta en demostración, ni eso: el renglón
          del simulador (el frasco, al pie del chat) ya dice que es de
          prueba, y el cartel era un renglón menos de mensajes (H048). */}
      <div className={pantallaCompleta && detalle && estado.proveedor === "demo" ? "contents max-sm:hidden" : "contents"}>
        <AvisoConexion estado={estado} compacto={pantallaCompleta} esAdmin={usuario.staffRole === "admin"} />
      </div>

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
        // Lo que va del mes en Meta, en dólares, es del admin: para quien
        // contesta era jerga (mes simulado).
        gasto={usuario.staffRole === "admin" ? gasto : null}
        mensajes={mensajes}
        botApagado={bot !== "si"}
      />
    </>
  );
}
