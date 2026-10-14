import { describe, expect, it } from "vitest";
import { leerPayload, type EventoWebhook, type MensajeDeMeta } from "@/lib/whatsapp/payload";
import * as P from "./fixtures/whatsapp/payloads";

/** El `value` del primer cambio, para tocar el payload en un test. */
function valor(payload: { entry: { changes: { value: unknown }[] }[] }) {
  return payload.entry[0].changes[0].value as {
    messages: Record<string, unknown>[];
    statuses: Record<string, unknown>[];
  };
}

function unMensaje(payload: unknown): MensajeDeMeta {
  const eventos = leerPayload(payload);
  expect(eventos).toHaveLength(1);
  const [evento] = eventos;
  if (evento.tipo !== "mensaje") throw new Error(`Se esperaba un mensaje y vino ${evento.tipo}`);
  return evento.mensaje;
}

describe("leerPayload: mensajes", () => {
  it("texto, con el nombre del perfil y el número del negocio", () => {
    const eventos = leerPayload(P.texto({ cuerpo: "Hola", nombre: "Marta", de: "5492235550123", ts: 1_790_000_000 }));
    expect(eventos[0]).toMatchObject({ tipo: "mensaje", phoneNumberId: P.CONSTANTES.PHONE_NUMBER_ID });
    const m = (eventos[0] as Extract<EventoWebhook, { tipo: "mensaje" }>).mensaje;
    expect(m).toMatchObject({
      de: "5492235550123",
      nombrePerfil: "Marta",
      tipo: "text",
      texto: "Hola",
      media: null,
      ocurrido: 1_790_000_000_000,
    });
    expect(m.waMessageId).toMatch(/^wamid\./);
  });

  it("imagen: el id para descargarla y el epígrafe como texto", () => {
    const m = unMensaje(P.imagen({ mediaId: "999", caption: "La pared" }));
    expect(m.tipo).toBe("image");
    expect(m.texto).toBe("La pared");
    expect(m.media).toMatchObject({ id: "999", tipo: "image", mime: "image/jpeg" });
  });

  it("documento con su nombre de archivo", () => {
    const m = unMensaje(P.documento({ nombreArchivo: "plano.pdf" }));
    expect(m.media).toMatchObject({ tipo: "document", nombre: "plano.pdf", mime: "application/pdf" });
  });

  it("audio de voz, video y sticker", () => {
    expect(unMensaje(P.audio()).media).toMatchObject({ tipo: "audio", voz: true });
    expect(unMensaje(P.video()).media).toMatchObject({ tipo: "video" });
    expect(unMensaje(P.sticker()).media).toMatchObject({ tipo: "sticker", mime: "image/webp" });
  });

  it("ubicación con enlace al mapa", () => {
    const m = unMensaje(P.ubicacion());
    expect(m.tipo).toBe("location");
    expect(m.texto).toContain("Obra Juan B. Justo");
    expect((m.datos?.ubicacion as { mapa: string }).mapa).toContain("-38.0204,-57.5714");
  });

  it("contactos compartidos", () => {
    const m = unMensaje(P.contactos());
    expect(m.texto).toBe("Contacto: Carlos Pereyra (+54 9 223 555-0199)");
  });

  it("respuestas a botones, a listas y al botón de una plantilla", () => {
    expect(unMensaje(P.respuestaBoton({ titulo: "Paso mañana" })).texto).toBe("Paso mañana");
    expect(unMensaje(P.respuestaLista()).texto).toBe("Juan B. Justo — Av. Juan B. Justo 4153");
    const boton = unMensaje(P.botonPlantilla({ texto: "Quiero que me llamen" }));
    expect(boton.tipo).toBe("button");
    expect(boton.texto).toBe("Quiero que me llamen");
  });

  it("una reacción apunta al mensaje que reacciona", () => {
    const m = unMensaje(P.reaccion({ aMensaje: "wamid.X", emoji: "🙏" }));
    expect(m.tipo).toBe("reaction");
    expect(m.reaccion).toEqual({ aMensaje: "wamid.X", emoji: "🙏" });
  });

  it("un mensaje citado guarda a cuál responde", () => {
    expect(unMensaje(P.texto({ citado: "wamid.ORIGINAL" })).citado).toBe("wamid.ORIGINAL");
  });

  it("lo que WhatsApp no deja ver entra igual, diciendo qué pasó", () => {
    const m = unMensaje(P.noSoportado());
    expect(m.tipo).toBe("unsupported");
    expect(m.texto).toContain("Message type unknown");
  });

  it("un tipo nuevo que no conocemos no rompe nada", () => {
    const payload = P.texto();
    const mensaje = valor(payload).messages[0];
    mensaje.type = "holograma";
    delete mensaje.text;
    const m = unMensaje(payload);
    expect(m.tipo).toBe("unsupported");
    expect(m.tipoOriginal).toBe("holograma");
  });

  it("los avisos de sistema", () => {
    expect(unMensaje(P.sistema()).texto).toContain("cambió su número");
  });
});

describe("leerPayload: estados", () => {
  it("entregado, con lo que Meta dice del cobro", () => {
    const [evento] = leerPayload(P.estado({ id: "wamid.A", estado: "delivered", categoria: "utility" }));
    expect(evento).toMatchObject({
      tipo: "estado",
      estado: {
        waMessageId: "wamid.A",
        estado: "delivered",
        error: null,
        cobro: { categoria: "utility", cobrable: true },
      },
    });
  });

  it("fallido, con código y motivo", () => {
    const [evento] = leerPayload(
      P.estado({ id: "wamid.B", estado: "failed", error: { code: 131047, title: "Re-engagement message" } }),
    );
    if (evento.tipo !== "estado") throw new Error("Se esperaba un estado");
    expect(evento.estado.error).toMatchObject({ codigo: 131047, titulo: "Re-engagement message" });
    expect(evento.estado.error?.detalle).toContain("24 hours");
  });

  it("un estado que no existe se descarta", () => {
    const payload = P.estado({ id: "wamid.C", estado: "sent" });
    valor(payload).statuses[0].status = "deleted";
    expect(leerPayload(payload)).toEqual([]);
  });
});

describe("leerPayload: otros campos", () => {
  it("cambio de estado de una plantilla", () => {
    expect(leerPayload(P.plantillaAprobada({ nombre: "pedido_listo", evento: "REJECTED", motivo: "INVALID_FORMAT" }))).toEqual([
      {
        tipo: "plantilla",
        nombre: "pedido_listo",
        idioma: "es_AR",
        estado: "REJECTED",
        motivo: "INVALID_FORMAT",
        metaId: "594425479261596",
      },
    ]);
  });

  it("calidad del número", () => {
    expect(leerPayload(P.calidad({ evento: "DOWNGRADE", limite: "TIER_250" }))[0]).toMatchObject({
      tipo: "calidad",
      evento: "DOWNGRADE",
      limite: "TIER_250",
    });
  });

  it("lo escrito desde el teléfono en coexistencia llega como eco", () => {
    const [evento] = leerPayload(P.ecoDelTelefono({ para: "5492235550123", cuerpo: "Dale" }));
    expect(evento).toMatchObject({ tipo: "eco", mensaje: { para: "5492235550123", texto: "Dale" } });
  });

  it("basura: nada, y sin excepciones", () => {
    expect(leerPayload(null)).toEqual([]);
    expect(leerPayload("hola")).toEqual([]);
    expect(leerPayload({ object: "page", entry: [] })).toEqual([]);
    expect(leerPayload({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{}] } }] }] })).toEqual([]);
    expect(leerPayload({ object: "whatsapp_business_account", entry: "x" })).toEqual([]);
  });
});

describe("leerPayload: usuarios sin número (BSUID)", () => {
  it("siempre trae el BSUID, y sin `from` el mensaje entra igual", () => {
    const conNumero = unMensaje(P.texto({ de: "5492235550123" }));
    expect(conNumero.usuarioMeta).toMatch(/^AR\./);

    const sinNumero = unMensaje(P.texto({ de: null, usuario: "AR.ABC123", nombre: "Usuario sin número" }));
    expect(sinNumero.de).toBe("");
    expect(sinNumero.usuarioMeta).toBe("AR.ABC123");
    expect(sinNumero.nombrePerfil).toBe("Usuario sin número");
  });

  it("las notas de voz escuchadas llegan como `played`", () => {
    const payload = P.estado({ id: "wamid.V", estado: "read" });
    valor(payload).statuses[0].status = "played";
    expect(leerPayload(payload)[0]).toMatchObject({ tipo: "estado", estado: { estado: "played" } });
  });
});
