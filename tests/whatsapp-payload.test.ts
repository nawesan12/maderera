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

describe("leerPayload: coexistencia", () => {
  it("el eco del ejemplo literal de Meta", () => {
    // Copiado de la referencia de `smb_message_echoes`.
    const literal = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "102290129340398",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" },
                message_echoes: [
                  {
                    from: "15550783881",
                    to: "16505551234",
                    id: "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA",
                    timestamp: "1739321024",
                    type: "text",
                    text: { body: "Here's the info you requested! https://www.meta.com/quest/quest-3/" },
                  },
                ],
              },
              field: "smb_message_echoes",
            },
          ],
        },
      ],
    };
    const [evento] = leerPayload(literal);
    expect(evento).toMatchObject({
      tipo: "eco",
      phoneNumberId: "106540352242922",
      mensaje: {
        para: "16505551234",
        waMessageId: "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBIyNDlBOEI5QUQ4NDc0N0FCNjMA",
        tipo: "text",
        ocurrido: 1_739_321_024_000,
      },
    });
  });

  it("un eco con foto trae el adjunto para bajarlo", () => {
    const [evento] = leerPayload(P.ecoConImagen({ mediaId: "999" }));
    expect(evento).toMatchObject({ tipo: "eco", mensaje: { tipo: "image", media: { id: "999", tipo: "image" } } });
  });

  it("un eco sin `from` entra igual (es el negocio); sin `to` o sin `id` se descarta", () => {
    expect(leerPayload(P.ecoDelTelefono({ sinCampo: "from" }))[0]).toMatchObject({ tipo: "eco" });
    expect(leerPayload(P.ecoDelTelefono({ sinCampo: "to" }))).toEqual([]);
    expect(leerPayload(P.ecoDelTelefono({ sinCampo: "id" }))).toEqual([]);
  });

  it("borrar y editar desde el teléfono", () => {
    expect(leerPayload(P.ecoCambio({ original: "wamid.A", cambio: "revoke" }))[0]).toEqual({
      tipo: "eco-cambio",
      phoneNumberId: P.CONSTANTES.PHONE_NUMBER_ID,
      cambio: "eliminado",
      original: "wamid.A",
      texto: null,
    });
    expect(leerPayload(P.ecoCambio({ original: "wamid.A", cambio: "edit", cuerpo: "Mejor el lunes" }))[0]).toMatchObject({
      cambio: "editado",
      texto: "Mejor el lunes",
    });
  });

  it("el historial: de quién es cada mensaje sale de comparar `from` con el número del negocio", () => {
    const [evento] = leerPayload(P.historial());
    if (evento.tipo !== "historial") throw new Error(evento.tipo);
    expect(evento.parte).toMatchObject({ fase: 0, orden: 1, progreso: 100 });
    const [hilo] = evento.parte.hilos;
    expect(hilo.waId).toBe("5492235550123");
    expect(hilo.mensajes.map((m) => [m.delNegocio, m.tipo, m.estadoHistorial])).toEqual([
      [false, "text", "READ"],
      [true, "text", "READ"],
      [true, "media_placeholder", "DELIVERED"],
    ]);
    // El adjunto todavía no llegó: un texto que lo dice, no el de «no se puede ver».
    expect(hilo.mensajes[2].texto).toMatch(/historial del teléfono/);
  });

  it("el negocio con el número sin el 9 sigue siendo el negocio", () => {
    const payload = P.historial({ hilos: [{ cliente: "5492235550123", mensajes: [{ delNegocio: true }] }] });
    const v = payload.entry[0].changes[0].value as unknown as {
      metadata: { display_phone_number: string };
      history: { threads: { messages: { from: string }[] }[] }[];
    };
    v.metadata.display_phone_number = "542235903118";
    expect(v.history[0].threads[0].messages[0].from).toBe("5492235903118");
    const [evento] = leerPayload(payload);
    if (evento.tipo !== "historial") throw new Error(evento.tipo);
    expect(evento.parte.hilos[0].mensajes[0].delNegocio).toBe(true);
  });

  it("los adjuntos del historial llegan aparte, con el mismo id", () => {
    const [evento] = leerPayload(P.historialMedio({ id: "wamid.PLACEHOLDER", mediaId: "24230790383178626" }));
    expect(evento).toMatchObject({
      tipo: "historial-medios",
      mensajes: [{ waMessageId: "wamid.PLACEHOLDER", media: { id: "24230790383178626" } }],
    });
  });

  it("historial rechazado por el negocio", () => {
    expect(leerPayload(P.historialRechazado())[0]).toMatchObject({
      tipo: "historial-error",
      codigo: 2593109,
      detalle: "History sharing is turned off by the business",
    });
  });

  it("la agenda de la app: altas con nombre, bajas sin él", () => {
    const [evento] = leerPayload(
      P.contactosDeLaApp({
        contactos: [
          { telefono: "5492235550123", nombre: "Marta Gómez" },
          { telefono: "5492235550199", accion: "remove" },
        ],
      }),
    );
    expect(evento).toEqual({
      tipo: "contactos",
      phoneNumberId: P.CONSTANTES.PHONE_NUMBER_ID,
      contactos: [
        { telefono: "5492235550123", nombre: "Marta Gómez", accion: "add" },
        { telefono: "5492235550199", nombre: null, accion: "remove" },
      ],
    });
  });

  it("Meta cortó la coexistencia por inactividad del teléfono", () => {
    expect(leerPayload(P.coexistenciaCortada())[0]).toEqual({
      tipo: "cuenta",
      evento: "PARTNER_REMOVED",
      motivo: "PRIMARY_INACTIVITY",
    });
  });

  it("historial con basura adentro: lo que se entiende entra, lo demás no", () => {
    const payload = P.historial();
    const v = payload.entry[0].changes[0].value as unknown as { history: { threads: unknown[] }[] };
    v.history[0].threads.push({ messages: [{ id: "x" }] }, "basura", { id: "5492235550777", messages: "no" });
    const [evento] = leerPayload(payload);
    if (evento.tipo !== "historial") throw new Error(evento.tipo);
    expect(evento.parte.hilos.map((h) => [h.waId, h.mensajes.length])).toEqual([
      ["5492235550123", 3],
      ["5492235550777", 0],
    ]);
  });
});
