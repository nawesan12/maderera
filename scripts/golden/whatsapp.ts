/**
 * Golden de WhatsApp: la lógica pura de lib/whatsapp corrida sobre los casos
 * de vitest y miles al azar (con semilla). El Go (internal/whatsapp) tiene
 * que dar exactamente lo mismo.
 *
 *   npx tsx scripts/golden/whatsapp.ts
 *
 * Escribe backend/testdata/golden/whatsapp/*.json y, además, el catálogo de
 * plantillas base que Go embebe (backend/internal/whatsapp/plantillas_base.json):
 * lib/whatsapp/plantillas-base.ts sigue siendo la fuente.
 *
 * `cuerpoDelMensaje` (proveedor-cloud.ts), `limpiar` y `resumen` (ingesta.ts)
 * y `EVENTOS_WHATSAPP` (avisos.ts) viven en módulos con `server-only` y base:
 * van copiados textualmente de git 9a17128.
 *
 * `firma.ts`, `errores.ts` y `payload.ts` ya no están en lib/whatsapp (se
 * mudaron a Go): se corren tal como eran en 9a17128, sacados de la historia
 * con `git show` a una carpeta temporal.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as N from "../../lib/whatsapp/numeros";
import * as V from "../../lib/whatsapp/ventana";
import * as C from "../../lib/whatsapp/costos";
import * as P from "../../lib/whatsapp/plantillas";

const historia = path.join(tmpdir(), "golden-whatsapp-9a17128");
mkdirSync(historia, { recursive: true });
for (const m of ["firma", "errores", "payload"]) {
  writeFileSync(path.join(historia, `${m}.ts`), execFileSync("git", ["show", `9a17128:lib/whatsapp/${m}.ts`]));
}
const { firmaValida, firmar } = createRequire(import.meta.url)(path.join(historia, "firma.ts")) as {
  firmaValida: (cuerpo: string, cabecera: string, secreto: string) => boolean;
  firmar: (cuerpo: string, secreto: string) => string;
};
const { explicarError, esFueraDeVentana } = createRequire(import.meta.url)(path.join(historia, "errores.ts")) as {
  explicarError: (codigo: number | null, detalle: string | null) => unknown;
  esFueraDeVentana: (codigo: number | null) => boolean;
};
const { leerPayload } = createRequire(import.meta.url)(path.join(historia, "payload.ts")) as { leerPayload: (crudo: unknown) => unknown[] };
import * as A from "../../lib/whatsapp/aviso-manual";
import { PLANTILLAS_BASE } from "../../lib/whatsapp/plantillas-base";
import * as F from "../../tests/fixtures/whatsapp/payloads";
import { SUCURSALES, sucursalPublicada } from "../../lib/sucursales";

// La hora fija: los payloads de ejemplo llevan Date.now() en los ids y en los
// timestamps, y así el golden sale igual cada vez que se corre.
Date.now = () => Date.UTC(2026, 9, 29, 12, 0, 0);

const destino = new URL("../../backend/testdata/golden/whatsapp/", import.meta.url);
mkdirSync(destino, { recursive: true });
const escribir = (nombre: string, datos: unknown) => {
  writeFileSync(new URL(nombre, destino), JSON.stringify(datos) + "\n");
  console.log(`${nombre}: ${Array.isArray(datos) ? datos.length : Object.keys(datos as object).length}`);
};

/* ------------------------------- azar con semilla ------------------------------- */
let semilla = 20261029;
function azar(): number {
  semilla |= 0;
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entero = (n: number) => Math.floor(azar() * n);
const elegir = <T>(l: readonly T[]): T => l[entero(l.length)];
const tira = (alfabeto: string, largo: number) => Array.from({ length: largo }, () => elegir([...alfabeto])).join("");

/* ---------------------------------- números ---------------------------------- */
const telefonosFijos = [
  "+54 9 223 590-3118", "(0223) 15-590-3118", "2235903118", "590-3118", "5492235903118", "542235903118",
  "223 15 590-3118", "15 590-3118", "011 15 4444-5555", "+54 11 4444-5555", "0054 9 11 4444 5555",
  "+54 0223 590 3118", "+1 415 555 2671", "0044 20 7946 0958", "+55 11 98765-4321", "", "   ", "abc", "12345",
  "4444-5555", "02254 15 41-2345", "+54 9 2254 41-2345", "549 11 4444 5555", "5411 4444 5555", "0 223 4123456",
  "+5492235550123", "5492235550123@s.whatsapp.net", "bsuid:AR.0123456789ABCDEF", "AR.0123456789ABCDEF",
  "ar.0123", "AR.", "AR.x".padEnd(140, "y"), " +54 9 223 590-3118﻿", "\u0085223 5903118", "+44", "00",
];
const digitosAzar = () => {
  const formas = [
    () => `+54 9 ${tira("0123456789", 3)} ${tira("0123456789", 3)}-${tira("0123456789", 4)}`,
    () => `0${tira("0123456789", 3)} 15 ${tira("0123456789", 3)}-${tira("0123456789", 4)}`,
    () => tira("0123456789 -()+", 6 + entero(14)),
    () => `${elegir(["", "+", "00", "0"])}${elegir(["54", "549", "5411", "1", "44", ""])}${tira("0123456789", 6 + entero(8))}`,
    () => tira("0123456789", entero(16)),
    () => `${tira("0123456789", 10)}@s.whatsapp.net`,
  ];
  return elegir(formas)();
};
const telefonos = [...telefonosFijos, ...Array.from({ length: 1500 }, digitosAzar)];
escribir(
  "numeros.json",
  telefonos.map((t) => ({
    t,
    nacional: N.numeroNacional(t),
    waId: N.aWaId(t),
    deMeta: N.waIdDeMeta(t),
    jid: N.jidDeWaId(t),
    deJid: N.waIdDeJid(t),
    legible: N.numeroLegible(t),
    bsuid: N.esBsuid(t),
    destino: N.destinoDeJid(t),
    sinNumero: N.sinNumero(t),
    mismo: N.mismoNumero(t, telefonos[(t.length * 7) % telefonos.length]),
    con: telefonos[(t.length * 7) % telefonos.length],
  })),
);

/* ---------------------------------- ventana ---------------------------------- */
const ahora = Date.UTC(2026, 9, 29, 15, 0, 0);
const desfases = [null, 0, 1, -1, 60_000, 59_999, 3_600_000, 23 * 3_600_000, 24 * 3_600_000 - 1, 24 * 3_600_000, 24 * 3_600_000 + 1, -3_600_000,
  ...Array.from({ length: 400 }, () => entero(2 * 86_400_000) - 3_600_000)];
escribir(
  "ventana.json",
  desfases.map((d) => {
    const ultimo = d === null ? null : new Date(ahora - d);
    const cierre = V.cierreDeVentana(ultimo, ahora);
    return {
      ultimo: ultimo?.toISOString() ?? null,
      ahora: new Date(ahora).toISOString(),
      abierta: V.ventanaAbierta(ultimo, ahora),
      cierre: cierre?.toISOString() ?? null,
      restante: V.restanteLegible(ultimo, ahora),
    };
  }),
);
const decisiones = [];
for (let i = 0; i < 32; i++) {
  const o = { activo: !!(i & 1), baja: !!(i & 2), ventanaAbierta: !!(i & 4), hayTextoLibre: !!(i & 8), hayPlantilla: !!(i & 16) };
  decisiones.push({ ...o, decision: V.decidirEnvio(o) });
}
const textosBaja = [
  "BAJA", "baja", "Baja.", " baja ", "STOP", "stop!", "darme de baja", "Dar de baja", "quiero la baja", "no me manden más",
  "No me manden más mensajes por favor", "no quiero recibir más avisos", "¿me das de baja el pedido de ayer?", "desuscribirme",
  "ALTA", "alta", "Start", "quiero recibir avisos", "quiero recibir los avisos", "dárme de bája", "BAJA 🙏", "baja baja", "",
  "basta", "parar", "cancelar suscripción", "no envíen más nada", "no escribas mas", "Ñ baja", "İ baja", "x".repeat(41),
  "no me manden mas avisos por favor muchas gracias", "no\tme\nmanden   más",
];
const palabras = ["baja", "BAJA", "no", "me", "manden", "más", "mas", "avisos", "alta", "stop", "por", "favor", "quiero", "la", "de", "dar", "!", "?", "¿", "🙏", "ñ", "á"];
const bajas = [...textosBaja, ...Array.from({ length: 1500 }, () => Array.from({ length: 1 + entero(5) }, () => elegir(palabras)).join(elegir([" ", "  ", "\n", "", "."])))];
escribir("bajas.json", { decisiones, textos: bajas.map((t) => ({ t, baja: V.esPedidoDeBaja(t), alta: V.esPedidoDeAlta(t) })) });

/* ----------------------------------- firma ----------------------------------- */
const firmas = [];
for (let i = 0; i < 600; i++) {
  const cuerpo = elegir([
    JSON.stringify(F.texto({ id: `wamid.${i}`, ts: 1760000000 + i })),
    tira("abcdefghijklmnñopqrstuvwxyzáéíóú {}\":,0123456789😀", entero(300)),
    "",
  ]);
  const secreto = elegir(["secreto-de-prueba", "", tira("abc123", 1 + entero(40))]);
  const buena = firmar(cuerpo, secreto || "x");
  const cabecera = elegir([
    buena,
    buena.toUpperCase().replace("SHA256=", "sha256="),
    ` ${buena}`,
    `${buena} `,
    buena.replace("sha256=", "sha256= "),
    buena.slice(0, -1),
    buena.slice(0, -1) + "0",
    "sha1=" + buena.slice(7),
    "",
    "sha256=",
    firmar(cuerpo + " ", secreto || "x"),
  ]);
  firmas.push({ cuerpo, secreto, cabecera, valida: firmaValida(cuerpo, cabecera, secreto), firma: secreto ? firmar(cuerpo, secreto) : null });
}
escribir("firma.json", firmas);

/* ----------------------------------- costos ---------------------------------- */
const categorias = [null, "utility", "service", "marketing", "authentication", "marketing_lite", "authentication_international", "referral_conversion", "UTILITY", "otra", ""];
const tarifasGuardadas = [
  null, {}, { utility: 0.03 }, { utility: "0,03" }, { utility: "0.031", service: -1, marketing: 12, authentication: null },
  { utility: true, service: [0.02], marketing: [1, 2], authentication: "" }, { service: " 0.04 ", marketing: "1e-2" }, { utility: 9.99 }, { utility: 10 },
];
const gastos = Array.from({ length: 400 }, () => {
  const tarifas = C.tarifasEfectivas(elegir(tarifasGuardadas) as Record<string, unknown> | null);
  const filas = Array.from({ length: entero(8) }, () => ({
    categoria: elegir(categorias),
    cobrable: elegir([true, false, null]),
    total: elegir([0, 1, 2, 3, 7, 13, 120, 1000, 3.7, -2, entero(5000)]),
    ...(azar() < 0.3 ? { estimado: true } : {}),
  }));
  const tope = elegir([0, 10, 5.5, 1, 100, 0.026, -1]);
  const gasto = C.calcularGasto(filas, tarifas);
  return { filas, tarifas, gasto, tope, estado: C.estadoDelTope(gasto.usd, tope), pasados: C.umbralesPasados(gasto.usd, tope) };
});
const categoriasDeTarifa = [...categorias, "MARKETING", "utility_x"].map((c) => ({ c, t: C.categoriaDeTarifa(c) }));
const efectivas = tarifasGuardadas.map((g) => ({ g, t: C.tarifasEfectivas(g as Record<string, unknown> | null) }));
const fechas = [
  "2026-10-01T02:59:59.999Z", "2026-10-01T03:00:00Z", "2026-10-31T23:30:00Z", "2026-12-31T23:59:00Z", "2027-01-01T03:00:00Z",
  ...Array.from({ length: 200 }, () => new Date(Date.UTC(2025, 0, 1) + entero(3 * 365 * 86_400_000)).toISOString()),
].map((f) => {
  const d = new Date(f);
  return { f, mes: C.mesArgentino(d), inicio: C.inicioDelMesArgentino(d).toISOString(), siguiente: C.inicioDelMesSiguienteArgentino(d).toISOString() };
});
const importes = [0, 0.026, 1.005, 2.675, 3.125, 1234.5, 1234567.891, -3.125, 0.0255, 0.12345, 9.999, 99.995, 0.0001, -0.001, 10,
  ...Array.from({ length: 400 }, () => Math.round(azar() * 10 ** entero(8)) / 10 ** entero(6))];
escribir("costos.json", {
  gastos,
  categoriasDeTarifa,
  efectivas,
  fechas,
  importes: importes.map((n) => ({ n, dolares: C.dolares(n), tarifa: C.tarifaLegible(n), moneda: new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n) })),
});

/* ---------------------------------- errores ---------------------------------- */
const codigos = [null, 0, 2, 10, 100, 190, 200, 368, 470, 131000, 131005, 131008, 131009, 131016, 131021, 131026, 131031, 131042, 131047, 131048,
  131049, 131050, 131051, 131052, 131053, 131056, 130429, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 133010, 1, 99999, 131047.5];
escribir(
  "errores.json",
  codigos.flatMap((c) =>
    [null, "", "Algo raro pasó", "x".repeat(170), "😀".repeat(90)].map((d) => ({ c, d, e: explicarError(c, d), fuera: esFueraDeVentana(c) })),
  ),
);

/* --------------------------------- plantillas -------------------------------- */
const helloWorld = {
  nombre: "hello_world", idioma: "en_US", categoria: "UTILITY", estado: "APPROVED", formato: "POSITIONAL",
  componentes: [
    { type: "HEADER", format: "TEXT", text: "Hello World" },
    { type: "BODY", text: "Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API, hosted by Meta." },
    { type: "FOOTER", text: "WhatsApp Business Platform sample message" },
  ],
};
const posicional = {
  nombre: "aviso_viejo", idioma: "es_AR", categoria: "utility", estado: "approved", formato: null,
  componentes: [
    { type: "header", text: "Pedido {{1}}", example: { header_text: ["PED-1"] } },
    { type: "BODY", text: "Hola {{1}}, tu pedido {{2}} está en {{ 3 }}. Gracias {{1}}.", example: { body_text: [["Marta", "PED-1", "Central"]] } },
    { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver", url: "https://mjbj.com.ar/pedido/{{1}}", example: ["abc"] }, { type: "QUICK_REPLY", text: "Gracias" }] },
  ],
};
const conDocumento = {
  nombre: "doc", idioma: "es_AR", categoria: null, estado: null, formato: "named",
  componentes: [
    { type: "HEADER", format: "DOCUMENT", example: { header_handle: ["x"] } },
    { type: "BODY", text: "Hola {{nombre}}, te mandamos {{documento}}.", example: { body_text_named_params: [{ param_name: "nombre", example: "Marta" }, { param_name: "documento" }] } },
    { type: "FOOTER", text: "" },
  ],
};
const raras = [
  { nombre: "vacia", idioma: "es", componentes: [] },
  { nombre: "sin_cuerpo", idioma: "es", componentes: [{ type: "HEADER", format: "IMAGE" }] },
  { nombre: "basura", idioma: "es", componentes: "no es una lista" },
  { nombre: "video", idioma: "es", componentes: [{ type: "HEADER", format: "VIDEO" }, { type: "BODY", text: "{{a}}{{b}} {{A}} {{a}}" }] },
];
const todas = [
  ...PLANTILLAS_BASE.map((p) => ({ nombre: p.nombre, idioma: p.idioma, categoria: p.categoria, estado: "APPROVED", formato: "NAMED", componentes: p.componentes })),
  helloWorld, posicional, conDocumento, ...raras,
];
const valoresAzar = () =>
  azar() < 0.03
    ? elegir(["x".repeat(1100), "😀".repeat(600)])
    : elegir([
    "", " ", "Marta", "Marta Gómez", "PED-1207", "Casa Central, Av. Juan B. Justo 1234", "línea 1\nlínea 2\tcon tab", "muchos      espacios",
        "$ 84.500", "  con bordes  ",
      ]);
const plantillas = todas.flatMap((t) => {
  const leida = P.leerPlantilla(t as Parameters<typeof P.leerPlantilla>[0]);
  return Array.from({ length: 12 }, () => {
    const valores: Record<string, string> = {};
    for (const c of leida.campos) if (azar() < 0.85) valores[c.clave] = valoresAzar();
    const conocidos: Record<string, string> = {};
    for (const k of ["nombre", "pedido", "sucursal", "boton", "documento", "total", "saldo", "a", "1"]) if (azar() < 0.5) conocidos[k] = valoresAzar();
    const media = elegir([null, { id: "12345", nombre: "R-1.pdf" }, { link: "https://x/y.pdf" }, { id: "9", nombre: "" }]);
    return {
      entrada: t,
      valores,
      conocidos,
      media,
      leida,
      vista: P.vistaPrevia(leida, valores),
      faltan: P.camposFaltantes(leida, valores).map((c) => c.clave),
      componentes: P.armarComponentes(leida, valores, media),
      sugeridos: P.sugerirValores(leida, conocidos),
      legible: P.nombreLegible(leida.nombre),
      marcadores: P.marcadores(leida.cuerpo),
    };
  });
});
const sueltos = Array.from({ length: 500 }, () => {
  const texto = Array.from({ length: entero(6) }, () => elegir(["Hola ", "{{nombre}}", "{{ pedido }}", "{{1}}", "{{x-y}}", "{{}}", "{{ A_b }}", "{", "}}", ". ", "\n"])).join("");
  const valores: Record<string, string> = {};
  for (const k of ["nombre", "pedido", "1", "A_b"]) if (azar() < 0.6) valores[k] = valoresAzar();
  const extra = valoresAzar();
  return { texto, valores, extra, completo: P.completar(texto, valores), marcadores: P.marcadores(texto), meta: P.valorParaMeta(texto + extra) };
});
escribir("plantillas.json", { plantillas, sueltos });

/* ----------------------------- mensajes que salen ---------------------------- */
// Copia textual de cuerpoDelMensaje (lib/whatsapp/proveedor-cloud.ts, git 9a17128).
type MensajeSaliente =
  | { tipo: "texto"; cuerpo: string; citado?: string | null }
  | { tipo: "media"; clase: "image" | "document" | "audio" | "video"; media: { id: string } | { link: string }; epigrafe?: string | null; nombreArchivo?: string | null; citado?: string | null }
  | { tipo: "plantilla"; nombre: string; idioma: string; componentes: Record<string, unknown>[] }
  | { tipo: "reaccion"; aMensaje: string; emoji: string };
function cuerpoDelMensaje(destino: string, mensaje: MensajeSaliente): Record<string, unknown> {
  const base = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...(N.esBsuid(destino) ? { recipient: destino } : { to: destino }),
  };
  switch (mensaje.tipo) {
    case "texto":
      return {
        ...base,
        ...(mensaje.citado ? { context: { message_id: mensaje.citado } } : {}),
        type: "text",
        text: { body: mensaje.cuerpo, preview_url: /https?:\/\//.test(mensaje.cuerpo) },
      };
    case "media": {
      const objeto: Record<string, unknown> = { ...mensaje.media };
      if (mensaje.epigrafe?.trim() && mensaje.clase !== "audio") objeto.caption = mensaje.epigrafe.trim();
      if (mensaje.clase === "document" && mensaje.nombreArchivo) objeto.filename = mensaje.nombreArchivo;
      return { ...base, ...(mensaje.citado ? { context: { message_id: mensaje.citado } } : {}), type: mensaje.clase, [mensaje.clase]: objeto };
    }
    case "plantilla":
      return {
        ...base,
        type: "template",
        template: { name: mensaje.nombre, language: { code: mensaje.idioma }, ...(mensaje.componentes.length > 0 ? { components: mensaje.componentes } : {}) },
      };
    case "reaccion":
      return { ...base, type: "reaction", reaction: { message_id: mensaje.aMensaje, emoji: mensaje.emoji } };
  }
}
// Copia textual de limpiar y resumen (lib/whatsapp/ingesta.ts, git 9a17128).
function limpiar(texto: string): string {
  let salida = "";
  for (const caracter of texto) {
    const codigo = caracter.codePointAt(0) ?? 0;
    if (caracter === "\n" || caracter === "\t") {
      salida += caracter;
      continue;
    }
    if (codigo > 0x1f && codigo !== 0x7f) salida += caracter;
  }
  return salida.slice(0, 8000);
}
const RESUMEN_DE_TIPO: Record<string, string> = {
  image: "📷 Foto", video: "🎥 Video", audio: "🎤 Audio", document: "📄 Documento", sticker: "Sticker", location: "📍 Ubicación", contacts: "👤 Contacto",
};
function resumen(cuerpo: string, tipo: string): string {
  const texto = cuerpo.trim().replace(/\s+/g, " ");
  const prefijo = RESUMEN_DE_TIPO[tipo];
  if (prefijo && texto && tipo !== "location" && tipo !== "contacts") return `${prefijo}: ${texto}`.slice(0, 120);
  if (texto) return texto.slice(0, 120);
  return prefijo ?? "Mensaje";
}
const textosRaros = () =>
  azar() < 0.02
    ? elegir(["a".repeat(8005), "😀".repeat(4001)])
    : elegir(["", "Hola", "  hola\n\n  che  ", "mirá https://mjbj.com.ar/pedido/1", "http:/no", "\u0000\u0007ctrl\u007f\u0085c1", "😀".repeat(70), "tab\taquí"]);
const salientes = Array.from({ length: 600 }, () => {
  const destinoMsj = elegir(["5492235550123", "AR.0123456789ABCDEF", "ar.x", ""]);
  const citado = elegir([undefined, null, "", "wamid.X"]);
  const m: MensajeSaliente = elegir([
    () => ({ tipo: "texto" as const, cuerpo: textosRaros(), citado }),
    () => ({
      tipo: "media" as const,
      clase: elegir(["image", "document", "audio", "video"] as const),
      media: elegir([{ id: "123" }, { link: "https://x/y" }]),
      epigrafe: elegir([undefined, null, "", "  foto  ", "doc"]),
      nombreArchivo: elegir([undefined, null, "", "R-1.pdf"]),
      citado,
    }),
    () => ({ tipo: "plantilla" as const, nombre: "pedido_listo", idioma: "es_AR", componentes: elegir([[], [{ type: "body", parameters: [{ type: "text", text: "x" }] }]]) }),
    () => ({ tipo: "reaccion" as const, aMensaje: "wamid.Y", emoji: elegir(["", "👍"]) }),
  ])();
  return { destino: destinoMsj, mensaje: m, cuerpo: cuerpoDelMensaje(destinoMsj, m) };
});
const textos = Array.from({ length: 400 }, () => {
  const t = textosRaros() + elegir(["", " ", "\r\n", textosRaros()]);
  const tipo = elegir(["text", "image", "video", "audio", "document", "sticker", "location", "contacts", "otro", "reaction"]);
  return { t, tipo, limpio: limpiar(t), resumen: resumen(t, tipo) };
});
escribir("salientes.json", { salientes, textos });

/* ---------------------------------- payloads --------------------------------- */
const base = { phoneNumberId: "106540352242922" };
const ejemplos: unknown[] = [
  F.texto(), F.texto({ de: null, usuario: "AR.0123456789ABCDEF" }), F.texto({ citado: "wamid.A", nombre: "" }), F.imagen({ caption: "foto" }),
  F.documento(), F.audio(), F.video(), F.sticker(), F.ubicacion(), F.contactos(), F.respuestaBoton(), F.respuestaLista(), F.botonPlantilla(),
  F.reaccion({ aMensaje: "wamid.B", emoji: "👍" }), F.reaccion({ aMensaje: "wamid.B" }), F.noSoportado(), F.sistema(),
  F.estado({ id: "wamid.C", estado: "sent" }), F.estado({ id: "wamid.C", estado: "delivered", categoria: "utility" }), F.estado({ id: "wamid.C", estado: "read", cobrable: false }),
  F.estado({ id: "wamid.C", estado: "failed" }), F.estado({ id: "wamid.C", estado: "failed", error: { code: 131026, title: "Message undeliverable" } }),
  F.plantillaAprobada({ nombre: "pedido_listo" }), F.plantillaAprobada({ nombre: "x", evento: "REJECTED", motivo: "INVALID_FORMAT" }), F.calidad(), F.calidad({ evento: "UPGRADE" }),
  F.ecoDelTelefono({ para: "5492235550123", cuerpo: "Sí, abrimos" }), F.ecoDelTelefono({ sinCampo: "to" }), F.ecoDelTelefono({ sinCampo: "id" }), F.ecoDelTelefono({ sinCampo: "from" }),
  F.ecoConImagen({ para: "5492235550123" }), F.ecoCambio({ original: "wamid.D", cambio: "revoke" }), F.ecoCambio({ original: "wamid.D", cambio: "edit", cuerpo: "corregido" }),
  F.historial({ ...base }), F.historialMedio({ id: "wamid.E" }), F.historialRechazado(), F.contactosDeLaApp({ contactos: [{ telefono: "5492235550123", nombre: "Marta" }, { telefono: "1", accion: "remove" }] }),
  F.coexistenciaCortada(), { object: "page" }, null, [], { object: "whatsapp_business_account", entry: [{ changes: [{ field: "nuevo_campo", value: {} }, { field: "messages" }, { value: { messages: [{}] } }] }] },
];
// Los mismos, con un campo cambiado al azar: tipos que no son, nulls, listas vacías.
function mutar(v: unknown, prob: number): unknown {
  if (azar() < prob) return elegir([null, 0, 1760000000, "1760000000", "", "x", [], {}, true, -1.5, "12.5", "0x10"]);
  if (Array.isArray(v)) return v.map((x) => mutar(x, prob));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (azar() > prob / 2) o[k] = mutar(x, prob);
    return o;
  }
  return v;
}
const payloads = [...ejemplos, ...Array.from({ length: 1200 }, () => mutar(elegir(ejemplos.slice(0, 37)), elegir([0.02, 0.05, 0.1])))].map((entrada) => ({
  entrada,
  eventos: leerPayload(entrada),
}));
escribir("payloads.json", payloads);

/* --------------------------------- aviso manual -------------------------------- */
const eventosManuales = Object.keys(A.AVISOS_MANUALES) as A.EventoManual[];
const avisos = Array.from({ length: 600 }, () => {
  const evento = elegir(eventosManuales);
  const valores: Record<string, string> = {};
  for (const k of ["pedido", "sucursal", "horario", "corte", "presupuesto", "total", "vence", "importe", "recibo", "saldo", "cheque", "motivo", "documento", "fecha"]) {
    if (azar() < 0.6) valores[k] = elegir(["", " ", "PED-1", "Casa Central, Juan B. Justo 1234", "lun a vie 8 a 17", "$ 84.500", "29/10/26", "R-0001", "¿raro? sí!"]);
  }
  const datos = {
    evento,
    nombre: elegir([null, undefined, "", "  ", "Marta Gómez", "Dr. Juan Pérez", "😀 Emoji"]),
    telefono: elegir([null, undefined, "", "  ", "223 590-3118", "abc", "+1 415 555 2671", " (0223) 15-590-3118 "]),
    valores,
    enlace: elegir([null, undefined, { texto: "Lo seguís acá", url: "https://mjbj.com.ar/pedido/PED-1?t=abc" }]),
  };
  return { datos, armado: A.armarAvisoManual(datos), primerNombre: A.primerNombre(datos.nombre) };
});
const enlaces = Array.from({ length: 200 }, () => {
  const t = elegir([null, "", "223 590-3118", "x"]);
  const tx = elegir([null, "", "Hola ¿qué tal? (a) *b* !~' \n ñ 😀 & = + / ? #"]);
  return { t, tx, e: A.enlaceWaMe(t, tx) };
});
const cuerpos = [...PLANTILLAS_BASE.map((p) => p.nombre), "no_existe"].map((n) => ({ n, c: A.cuerpoDePlantilla(n) }));
escribir("aviso-manual.json", { avisos, enlaces, cuerpos, manuales: A.AVISOS_MANUALES });

// Copia textual de los eventos y sus textos (EVENTOS_WHATSAPP en lib/whatsapp/avisos.ts, git 9a17128).
const EVENTOS_WHATSAPP = [
  { evento: "pedido_recibido", titulo: "Cuando entra un pedido por la web", cuando: "Confirma que lo recibimos. El correo ya lo dice; esto es para quien no lo lee.", plantilla: "pedido_recibido", textoLibre: "Hola {{nombre}}, recibimos tu pedido {{pedido}}. Te avisamos por acá cuando esté listo." },
  { evento: "preparando", titulo: "Cuando se empieza a preparar", cuando: "Apenas alguien mueve el pedido a Preparando.", plantilla: "pedido_preparando", textoLibre: "Hola {{nombre}}, ya estamos preparando tu pedido {{pedido}}. Te avisamos apenas esté listo." },
  { evento: "listo", titulo: "Cuando queda listo", cuando: "El aviso que más consultas evita: el cliente sabe cuándo venir.", plantilla: "pedido_listo", textoLibre: "Hola {{nombre}}, tu pedido {{pedido}} ya está listo para retirar en {{sucursal}}." },
  { evento: "en-camino", titulo: "Cuando sale el flete", cuando: "Solo en pedidos con envío.", plantilla: "pedido_en_camino", textoLibre: "Hola {{nombre}}, tu pedido {{pedido}} salió para la dirección de entrega." },
  { evento: "entregado", titulo: "Cuando se entrega", cuando: "Cierra el círculo y deja la conversación abierta por si hay algo.", plantilla: "pedido_entregado", textoLibre: "Hola {{nombre}}, entregamos tu pedido {{pedido}}. Gracias por elegirnos." },
  { evento: "presupuesto_listo", titulo: "Cuando se manda un presupuesto", cuando: "Sale con el PDF del presupuesto pegado.", plantilla: "presupuesto_enviado", textoLibre: "Hola {{nombre}}, te mandamos el presupuesto {{presupuesto}} por {{total}}. Vale hasta el {{vence}}." },
  { evento: "recibo_emitido", titulo: "Cuando se registra un pago", cuando: "Sale con el PDF del recibo y el saldo que le queda.", plantilla: "recibo_emitido", textoLibre: "Hola {{nombre}}, registramos tu pago de {{importe}}. Te mandamos el recibo {{recibo}}; tu saldo quedó en {{saldo}}." },
  { evento: "cheque_rechazado", titulo: "Cuando se rechaza un cheque", cuando: "No se tomó o lo rechazó el banco: el importe vuelve a la cuenta.", plantilla: "cheque_rechazado", textoLibre: "Hola {{nombre}}, el cheque {{cheque}} por {{importe}} no se pudo acreditar ({{motivo}}). El importe volvió a tu cuenta corriente." },
];
escribir("eventos.json", EVENTOS_WHATSAPP);

// Copia textual de datosDeSucursal (lib/whatsapp/avisos.ts, mismo commit).
function datosDeSucursal(nombre: string | null, slug: string | null) {
  const publicada = (slug && sucursalPublicada(slug)) || SUCURSALES.find((s) => s.nombre === nombre) || SUCURSALES[0];
  return {
    sucursal: publicada ? `${publicada.nombre}, ${publicada.direccion.replace(/, Mar del Plata$/, "")}` : nombre ?? "la sucursal",
    horario: publicada?.horario ?? "",
  };
}
const nombresSuc = [null, "", "Casa Central", "Aserradero", "Otra"];
const slugs = [null, "", "casa-central", "aserradero", "otra"];
escribir("sucursales.json", nombresSuc.flatMap((n) => slugs.map((s) => ({ n, s, d: datosDeSucursal(n, s) }))));

writeFileSync(
  new URL("../../backend/internal/whatsapp/plantillas_base.json", import.meta.url),
  JSON.stringify(PLANTILLAS_BASE, null, 1) + "\n",
);
console.log(`plantillas_base.json: ${PLANTILLAS_BASE.length}`);
