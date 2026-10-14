import { describe, expect, it } from "vitest";
import { firmaValida, firmar } from "@/lib/whatsapp/firma";
import {
  cierreDeVentana,
  decidirEnvio,
  esPedidoDeAlta,
  esPedidoDeBaja,
  restanteLegible,
  ventanaAbierta,
  VENTANA_MS,
} from "@/lib/whatsapp/ventana";
import {
  armarComponentes,
  camposFaltantes,
  contarVariables,
  leerPlantilla,
  sugerirValores,
  valorParaMeta,
  vistaPrevia,
} from "@/lib/whatsapp/plantillas";
import { PLANTILLAS_BASE } from "@/lib/whatsapp/plantillas-base";
import { esDeCredenciales, esFueraDeVentana, explicarError } from "@/lib/whatsapp/errores";
import { cuerpoDelMensaje } from "@/lib/whatsapp/proveedor-cloud";
import * as P from "./fixtures/whatsapp/payloads";

describe("firma del webhook", () => {
  const secreto = "secreto-de-la-app";
  const cuerpo = JSON.stringify(P.texto({ cuerpo: "¿Tienen fenólico?" }));

  it("acepta la firma de Meta sobre el cuerpo crudo", () => {
    expect(firmaValida(cuerpo, firmar(cuerpo, secreto), secreto)).toBe(true);
    expect(firmaValida(Buffer.from(cuerpo), firmar(cuerpo, secreto), secreto)).toBe(true);
  });

  it("rechaza otra firma, otro secreto o el cuerpo tocado", () => {
    expect(firmaValida(cuerpo, firmar(cuerpo, "otro"), secreto)).toBe(false);
    expect(firmaValida(cuerpo + " ", firmar(cuerpo, secreto), secreto)).toBe(false);
    // Volver a serializar cambia bytes: la «á» escapada no es la misma firma.
    const reserializado = JSON.stringify(JSON.parse(cuerpo)).replace("¿", "\\u00bf");
    expect(firmaValida(reserializado, firmar(cuerpo, secreto), secreto)).toBe(false);
  });

  it("sin cabecera, sin prefijo o sin secreto, no", () => {
    expect(firmaValida(cuerpo, null, secreto)).toBe(false);
    expect(firmaValida(cuerpo, firmar(cuerpo, secreto).replace("sha256=", ""), secreto)).toBe(false);
    expect(firmaValida(cuerpo, firmar(cuerpo, secreto), null)).toBe(false);
    expect(firmaValida(cuerpo, "sha256=corta", secreto)).toBe(false);
  });
});

describe("ventana de 24 h", () => {
  const ahora = Date.UTC(2026, 9, 14, 15, 0);

  it("abierta hasta las 24 h del último mensaje del cliente", () => {
    expect(ventanaAbierta(new Date(ahora - 23 * 3_600_000), ahora)).toBe(true);
    expect(ventanaAbierta(new Date(ahora - VENTANA_MS + 1000), ahora)).toBe(true);
    expect(ventanaAbierta(new Date(ahora - VENTANA_MS), ahora)).toBe(false);
    expect(ventanaAbierta(null, ahora)).toBe(false);
    // Lo que llega serializado del servidor.
    expect(ventanaAbierta(new Date(ahora - 3_600_000).toISOString(), ahora)).toBe(true);
  });

  it("dice cuánto queda como lo diría una persona", () => {
    expect(restanteLegible(new Date(ahora - 20 * 3_600_000), ahora)).toBe("4 h");
    expect(restanteLegible(new Date(ahora - VENTANA_MS + 40 * 60_000), ahora)).toBe("40 min");
    expect(restanteLegible(new Date(ahora - VENTANA_MS - 1), ahora)).toBeNull();
    expect(cierreDeVentana(new Date(ahora), ahora)?.getTime()).toBe(ahora + VENTANA_MS);
  });

  it("decide cómo sale un aviso", () => {
    const base = { activo: true, baja: false, ventanaAbierta: true, hayTextoLibre: true, hayPlantilla: true };
    expect(decidirEnvio(base)).toEqual({ como: "texto" });
    expect(decidirEnvio({ ...base, ventanaAbierta: false })).toEqual({ como: "plantilla" });
    expect(decidirEnvio({ ...base, hayTextoLibre: false })).toEqual({ como: "plantilla" });
    expect(decidirEnvio({ ...base, baja: true })).toEqual({ como: "omitir", motivo: "baja" });
    expect(decidirEnvio({ ...base, activo: false })).toEqual({ como: "omitir", motivo: "apagado" });
    expect(decidirEnvio({ ...base, ventanaAbierta: false, hayPlantilla: false })).toEqual({
      como: "omitir",
      motivo: "sin-plantilla",
    });
  });
});

describe("BAJA y ALTA", () => {
  it("reconoce las formas en que la gente pide la baja", () => {
    for (const texto of ["BAJA", "baja", "Baja.", "STOP", "dar de baja", "Quiero la baja", "no me manden más", "No me envíen más mensajes por favor"]) {
      expect(esPedidoDeBaja(texto), texto).toBe(true);
    }
  });

  it("una consulta que menciona la baja no es una baja", () => {
    for (const texto of ["¿me das de baja el pedido de ayer?", "La baja de precio sigue?", "Hola", ""]) {
      expect(esPedidoDeBaja(texto), texto).toBe(false);
    }
  });

  it("ALTA vuelve a habilitar", () => {
    expect(esPedidoDeAlta("ALTA")).toBe(true);
    expect(esPedidoDeAlta("alta del cliente nuevo")).toBe(false);
  });
});

describe("plantillas", () => {
  const listo = PLANTILLAS_BASE.find((p) => p.nombre === "pedido_listo")!;
  const leida = leerPlantilla({
    nombre: listo.nombre,
    idioma: listo.idioma,
    formato: listo.formatoParametros,
    componentes: listo.componentes,
  });

  it("lee los datos con nombre y sus ejemplos", () => {
    expect(leida.formato).toBe("NAMED");
    expect(leida.campos.map((c) => c.clave)).toEqual(["cuerpo:nombre", "cuerpo:pedido", "cuerpo:sucursal", "cuerpo:horario"]);
    expect(leida.campos[1].ejemplo).toBe("PED-1207");
    expect(leida.pie).toBe("Maderera Juan B. Justo");
  });

  it("arma los componentes con parameter_name, sin saltos de línea", () => {
    const valores = { "cuerpo:nombre": "Marta", "cuerpo:pedido": "PED-1", "cuerpo:sucursal": "Casa\nCentral", "cuerpo:horario": "8 a 16" };
    expect(armarComponentes(leida, valores)).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", parameter_name: "nombre", text: "Marta" },
          { type: "text", parameter_name: "pedido", text: "PED-1" },
          { type: "text", parameter_name: "sucursal", text: "Casa Central" },
          { type: "text", parameter_name: "horario", text: "8 a 16" },
        ],
      },
    ]);
  });

  it("las posicionales van en orden y sin nombre", () => {
    const vieja = leerPlantilla({
      nombre: "pedido_listo",
      idioma: "es_AR",
      componentes: [{ type: "BODY", text: "Hola {{1}}, el pedido {{2}} está en {{3}}. Gracias.", example: { body_text: [["Ana", "PED-1", "Casa Central"]] } }],
    });
    const valores = sugerirValores(vieja, { nombre: "Ana", pedido: "PED-9", sucursal: "Aserradero" });
    expect(vistaPrevia(vieja, valores)).toBe("Hola Ana, el pedido PED-9 está en Aserradero. Gracias.");
    expect(armarComponentes(vieja, valores)[0]).toEqual({
      type: "body",
      parameters: [
        { type: "text", text: "Ana" },
        { type: "text", text: "PED-9" },
        { type: "text", text: "Aserradero" },
      ],
    });
  });

  it("el PDF del encabezado va por id, con su nombre", () => {
    const base = PLANTILLAS_BASE.find((p) => p.nombre === "documento_adjunto")!;
    const doc = leerPlantilla({ nombre: base.nombre, idioma: "es_AR", formato: "NAMED", componentes: base.componentes });
    expect(doc.encabezadoMedia).toBe("document");
    const componentes = armarComponentes(doc, { "cuerpo:nombre": "Ana", "cuerpo:documento": "el remito R-1" }, { id: "123", nombre: "R-1.pdf" });
    expect(componentes[0]).toEqual({ type: "header", parameters: [{ type: "document", document: { id: "123", filename: "R-1.pdf" } }] });
  });

  it("dice qué falta y muestra el hueco en vez de taparlo", () => {
    expect(camposFaltantes(leida, { "cuerpo:nombre": "Ana" }).map((c) => c.marcador)).toEqual(["pedido", "sucursal", "horario"]);
    expect(vistaPrevia(leida, { "cuerpo:nombre": "Ana" })).toContain("tu pedido {{pedido}}");
  });

  it("los textos base respetan las reglas de Meta", () => {
    for (const p of PLANTILLAS_BASE) {
      const cuerpo = (p.componentes.find((c) => c.type === "BODY")?.text ?? "").trim();
      expect(cuerpo, p.nombre).not.toMatch(/^\{\{/); // no empieza con variable
      expect(cuerpo, p.nombre).not.toMatch(/\}\}[.!?]?$/); // ni termina con una
      expect(cuerpo, p.nombre).not.toMatch(/\}\}\s*\{\{/); // ni dos seguidas
      expect(cuerpo.length, p.nombre).toBeLessThanOrEqual(1024);
      expect(p.nombre).toMatch(/^[a-z0-9_]+$/);
      // Cada variable tiene su ejemplo.
      const ejemplos = (p.componentes.find((c) => c.type === "BODY") as { example?: { body_text_named_params?: { param_name: string }[] } })
        ?.example?.body_text_named_params?.map((e) => e.param_name);
      expect(ejemplos?.sort(), p.nombre).toEqual(leerPlantilla({ nombre: p.nombre, idioma: p.idioma, formato: "NAMED", componentes: p.componentes }).campos.filter((c) => c.donde === "cuerpo").map((c) => c.marcador).sort());
    }
  });

  it("cuenta variables sin repetir y limpia los valores", () => {
    expect(contarVariables("{{1}} y {{2}} y otra vez {{1}}")).toBe(2);
    expect(valorParaMeta("  a\tb\n\nc      d ")).toBe("a b c   d");
  });
});

describe("errores de Meta", () => {
  it("explica los que importan y dice qué hacer", () => {
    expect(explicarError(131047)).toMatchObject({ accion: "plantilla" });
    expect(explicarError(190)).toMatchObject({ accion: "sistema" });
    expect(explicarError(131026)).toMatchObject({ accion: "otro-medio" });
    expect(explicarError(130429)).toMatchObject({ accion: "reintentar" });
    expect(explicarError(999999, "Something").texto).toContain("Something");
    expect(esFueraDeVentana(131047)).toBe(true);
    expect(esDeCredenciales(190)).toBe(true);
  });
});

describe("cuerpo del envío", () => {
  it("texto citando un mensaje", () => {
    expect(cuerpoDelMensaje("5492235550123", { tipo: "texto", cuerpo: "Sí", citado: "wamid.X" })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5492235550123",
      context: { message_id: "wamid.X" },
      type: "text",
      text: { body: "Sí", preview_url: false },
    });
  });

  it("documento por id, y a un usuario sin número por su BSUID", () => {
    expect(
      cuerpoDelMensaje("AR.ABC123", {
        tipo: "media",
        clase: "document",
        media: { id: "77" },
        epigrafe: "Tu remito",
        nombreArchivo: "R-1.pdf",
      }),
    ).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      recipient: "AR.ABC123",
      type: "document",
      document: { id: "77", caption: "Tu remito", filename: "R-1.pdf" },
    });
  });

  it("reacción", () => {
    expect(cuerpoDelMensaje("549223", { tipo: "reaccion", aMensaje: "wamid.Y", emoji: "👍" })).toMatchObject({
      type: "reaction",
      reaction: { message_id: "wamid.Y", emoji: "👍" },
    });
  });
});
