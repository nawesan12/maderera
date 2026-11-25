/**
 * Golden de la tanda 10: campañas, bajas, avisos, profesionales y eventos.
 *
 * Corre el TS real —lib/campanas, lib/profesionales/fichas.ts y las
 * plantillas de los avisos— sobre los casos de vitest más miles al azar con
 * semilla. Lo que se borró al mudarlo a Go quedó copiado tal cual en
 * `scripts/golden/originales/tanda10/` (de git c6c65eb / go-cuentas 56ef2a1),
 * con los esquemas de zod de las acciones, que no se exportaban. El Go
 * (internal/campanas, internal/avisos, internal/profesionales) tiene que dar
 * lo mismo exacto.
 *
 * Con la zona de Argentina: las fechas de los avisos de eventos se escriben
 * en hora de Buenos Aires (en el TS dependían de la zona del servidor, que en
 * producción es UTC: ver progreso.md, tanda 10).
 *
 *   TZ=America/Argentina/Buenos_Aires npx tsx scripts/golden/campanas.ts
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

const requerir = createRequire(import.meta.url);
const rutaServerOnly = requerir.resolve("server-only");
requerir.cache[rutaServerOnly] = { id: rutaServerOnly, filename: rutaServerOnly, loaded: true, exports: {} } as never;

process.env.APP_URL = "https://mjbj.com.ar/";
process.env.BETTER_AUTH_SECRET = "secreto-de-prueba-de-las-bajas-32-caracteres";

if (process.env.TZ !== "America/Argentina/Buenos_Aires") {
  throw new Error("Correlo con TZ=America/Argentina/Buenos_Aires");
}

const DESTINO = new URL("../../backend/testdata/golden/campanas/", import.meta.url);

function mulberry32(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const azar = mulberry32(20261029);
const entre = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1));
const uno = <T,>(xs: readonly T[]): T => xs[Math.floor(azar() * xs.length)];

function escribir(nombre: string, datos: unknown) {
  writeFileSync(new URL(nombre, DESTINO), JSON.stringify(datos, null, 1) + "\n");
  console.log(nombre, Array.isArray(datos) ? datos.length : "");
}

/** El primer problema de zod, o los datos ya transformados. */
function zodResultado(r: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] }; data?: unknown }) {
  if (r.success) return { ok: true, datos: r.data };
  const i = r.error!.issues[0];
  return { ok: false, campo: i.path.map(String).join("."), mensaje: i.message };
}

const PIEZAS = [
  "Hola", "**oferta**", "fenólico", "https://mjbj.com.ar/catalogo", "http://x.com/a?b=1&c=2.",
  "<b>no</b>", "& más", "\"comillas\"", "- uno", "• dos", "-sin espacio", "  ", "\n", "\n\n", "\r\n",
  "\n  \n", "**sin cerrar", "a**b**c", "(https://mjbj.com.ar/eventos)", "¡Hasta el 30/11!", "🌲", "'apóstrofo'",
  "50% off", "https://a.b/c,d", "—", "\t", "ok.", "-  tres",
];

function textoAlAzar(): string {
  let t = "";
  const n = entre(0, 14);
  for (let i = 0; i < n; i++) t += uno(PIEZAS) + uno(["", " ", " ", "\n", "\n\n"]);
  return t;
}

async function main() {
  mkdirSync(DESTINO, { recursive: true });

  const { leerCuerpo, cuerpoComoParrafos } = await import("./originales/tanda10/campanas/cuerpo");
  const baja = await import("./originales/tanda10/campanas/baja");
  const segmento = await import("./originales/tanda10/campanas/segmento");
  const { armarCorreoDeCampana } = await import("./originales/tanda10/campanas/correo");
  const { decidirFicha } = await import("./originales/tanda10/fichas");
  const formularios = await import("./originales/tanda10/formularios");
  const plantillas = await import("./originales/tanda10/plantillas");
  const { primerNombre } = await import("../../lib/formato");
  const { RUBROS_CLIENTE } = await import("../../lib/rubros-cliente");
  const { ORDEN_EVENTOS } = await import("../../lib/notificaciones/titulos");

  /* ------------------------------ cuerpo ------------------------------ */
  const cuerpos = [
    "Hola\n\nChau",
    "Párrafo uno\ncon salto\n\n- uno\n- dos\n\nFin **negrita** y https://mjbj.com.ar.",
    "<script>alert(1)</script> & **<b>**",
    "",
    "   \n\n  ",
    "- a\nb",
    "• x\n• y",
    "Mirá https://mjbj.com.ar/catalogo?x=1&y=2, está bueno!",
  ];
  for (let i = 0; i < 1500; i++) cuerpos.push(textoAlAzar());
  escribir(
    "cuerpo.json",
    cuerpos.map((c) => ({ cuerpo: c, bloques: leerCuerpo(c), parrafos: cuerpoComoParrafos(c) })),
  );

  /* ------------------------------ bajas ------------------------------ */
  const secreto = process.env.BETTER_AUTH_SECRET!;
  const correos = [
    "ana@mjbj.com.ar", "  Ana@MJBJ.com.ar ", "juan.perez+promo@gmail.com", "x@y.z", "ñandú@correo.com.ar",
    "a@b", "sin-arroba", "", "dos@@arrobas.com", "con espacio@x.com",
  ];
  const letras = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.@+ñ";
  for (let i = 0; i < 400; i++) {
    let c = "";
    for (let j = entre(1, 24); j > 0; j--) c += letras[entre(0, letras.length - 1)];
    correos.push(azar() < 0.6 ? `${c}@${uno(["mjbj.com.ar", "gmail.com", "x.io", "a"])}` : c);
  }
  const casosBaja = correos.map((email) => {
    const p = baja.parametrosDeBaja(email, secreto);
    const otro = baja.parametrosDeBaja(email + "x", secreto);
    return {
      email,
      normal: baja.normalizarCorreo(email),
      e: p.e,
      t: p.t,
      verifica: baja.verificarBaja(p.e, p.t, secreto),
      conOtraFirma: baja.verificarBaja(p.e, otro.t, secreto),
      conOtroSecreto: baja.verificarBaja(p.e, p.t, secreto + "!"),
      firmaCorta: baja.verificarBaja(p.e, p.t.slice(0, 31), secreto),
      sinFirma: baja.verificarBaja(p.e, "", secreto),
    };
  });
  escribir("bajas.json", casosBaja);

  const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_+/=. %";
  const decodificar: { e: string; email: string | null }[] = [];
  for (const c of correos.slice(0, 60)) decodificar.push({ e: baja.codificarCorreo(c), email: null });
  for (let i = 0; i < 600; i++) {
    let e = "";
    for (let j = entre(0, 40); j > 0; j--) e += b64[entre(0, b64.length - 1)];
    decodificar.push({ e, email: null });
  }
  for (const d of decodificar) d.email = baja.decodificarCorreo(d.e);
  escribir("decodificar.json", decodificar);

  /* ------------------------------ segmento ------------------------------ */
  const RUBROS = RUBROS_CLIENTE.map((r) => r.valor);
  const tipos = [null, "", "todos", "particular", "profesional", "empresa", "Profesional"];
  const actividades = [null, "", "compraron", "sinComprar", "otro"];
  const meses = [null, "", "0", "1", "1.4", "1.5", "2", "12", "59.5", "60", "60.4", "61", "-3", "abc", " 6 ", "1e1", 3, 7.5, "Infinity", "0x10"];
  const segmentos = [];
  for (let i = 0; i < 2000; i++) {
    const datos = {
      tipo: uno(tipos),
      rubros: Array.from({ length: entre(0, 4) }, () => uno([...RUBROS, "inventado", "Carpintero", ""])),
      actividad: uno(actividades),
      meses: uno(meses),
    };
    const s = segmento.leerSegmento(datos, RUBROS);
    segmentos.push({ datos, segmento: s, descripcion: segmento.describirSegmento(s) });
  }
  escribir("segmentos.json", segmentos);

  const duraciones = [];
  for (const cantidad of [0, 1, 2, 3, 5, 59, 60, 61, 119, 120, 179, 180, 1000, 5000, 100000, 1440 * 3, 99999])
    for (const pm of [0, 1, 3, 5, 60, 1000]) duraciones.push({ cantidad, porMinuto: pm, texto: segmento.duracionDelEnvio(cantidad, pm) });
  for (let i = 0; i < 500; i++) {
    const cantidad = entre(0, 200000);
    const pm = entre(0, 120);
    duraciones.push({ cantidad, porMinuto: pm, texto: segmento.duracionDelEnvio(cantidad, pm) });
  }
  escribir("duraciones.json", duraciones);

  /* ------------------------------ el correo ------------------------------ */
  const correosDeCampana = [];
  const enlaces = [null, "", "/catalogo", "catalogo", "https://otra.com/x?a=1&b=2", "http://x.io", "/promos/oferta"];
  const nombres = [null, "", "Ana", "Arq. Juan Pérez", "  María   José ", "Ing.", "sr. pepe", "Lic Laura Gómez"];
  for (let i = 0; i < 400; i++) {
    const campana = {
      asunto: uno(["Ofertas de noviembre", "Fenólicos <18 mm> & más", "¡Llegó el pino!", "x"]),
      adelanto: uno([null, "", "Hasta el 30", "Promo \"especial\""]),
      cuerpo: textoAlAzar() || "Hola",
      imagenUrl: uno(enlaces),
      botonTexto: uno([null, "", "Ver catálogo", "Comprar <ya>"]),
      botonUrl: uno(enlaces),
    };
    const destinatario = { email: uno(correos.slice(0, 5)), nombre: uno(nombres) };
    correosDeCampana.push({ campana, destinatario, correo: armarCorreoDeCampana(campana, destinatario) });
  }
  escribir("correos.json", correosDeCampana);

  const nombresSueltos = [...nombres.filter((n) => n !== null), "Dra. Ana", "téc. Ruiz", "Cra Sosa", "ARQ. LUIS", "Prof.", "  ", "Esc. Juana Pérez"];
  escribir("primer-nombre.json", nombresSueltos.map((n) => ({ nombre: n, primero: primerNombre(n as string) })));

  /* ------------------------------ formularios ------------------------------ */
  const U = "8f2b5c1e-1d2a-4c3b-9a8e-111111111111";
  const largo = (n: number) => "x".repeat(n);
  const casosCampana: Record<string, unknown>[] = [];
  const asuntos = [null, "", "ab", " abc ", "Ofertas", largo(150), largo(151), "🌲🌲", "🌲a", " 🌲🌲 "];
  const adelantos = [undefined, " ", "Hola", largo(150), largo(151)];
  const cuerpoCasos = [null, "", "corto", "  diez letras  ", "Hola a todos los clientes", largo(10000), largo(10001)];
  const urlCasos = [undefined, " ", "/catalogo", "https://x.com", "http://x", "javascript:alert(1)", "catalogo", " /a ", largo(501), "/" + largo(500)];
  const botones = [undefined, " ", "Ver", largo(40), largo(41)];
  for (let i = 0; i < 2500; i++) {
    casosCampana.push({
      asunto: uno(asuntos),
      adelanto: uno(adelantos),
      cuerpo: uno(cuerpoCasos),
      imagenUrl: uno(urlCasos),
      botonTexto: uno(botones),
      botonUrl: uno(urlCasos),
    });
  }
  escribir("form-campana.json", casosCampana.map((c) => ({ entrada: c, ...zodResultado(formularios.esquemaCampana.safeParse(c)) })));

  const cuandos = ["2026-11-05T18:00", "2026-11-05T18:00:00", "2026-02-30T10:00", "2026-11-05", "", "x", "2026-13-01T10:00",
    "2026-11-05T24:00", "2026-11-05T23:59", "2027-01-01T00:00", "2026-11-5T8:00", " 2026-11-05T18:00", "2026-11-05T18:60"];
  escribir("programar.json", cuandos.map((c) => {
    const f = new Date(`${c}:00-03:00`);
    return { cuando: c, iso: Number.isNaN(f.getTime()) ? null : f.toISOString() };
  }));

  const casosAviso: Record<string, unknown>[] = [];
  for (const id of [null, "", U, "no-uuid", U.toUpperCase()])
    for (const activo of [null, "si", "no", "sí", ""]) casosAviso.push({ id, activo });
  escribir("form-aviso.json", casosAviso.map((c) => ({ entrada: c, ...zodResultado(formularios.esquemaAvisoActivo.safeParse(c)) })));
  const casosTexto: Record<string, unknown>[] = [];
  for (const id of [null, U, "x"])
    for (const asunto of [null, "", "ab", " abc ", largo(120), largo(121)])
      for (const encabezado of [undefined, "Hola", largo(160), largo(161), "  "]) casosTexto.push({ id, asunto, encabezado });
  escribir("form-aviso-texto.json", casosTexto.map((c) => ({ entrada: c, ...zodResultado(formularios.esquemaAvisoTexto.safeParse(c)) })));

  // Solicitud de acceso profesional.
  const docs: [string | null, string | null][] = [
    ["cuit", "20-12345678-6"], ["cuit", "20123456786"], ["cuit", "20123456789"], ["cuit", "30-58944525-9"], ["cuit", "123"],
    ["dni", "12345678"], ["dni", "1234567"], ["dni", "123456"], ["dni", "12.345.678"], ["dni", "20123456786"],
    ["pasaporte", "1"], [null, "12345678"], ["cuit", ""], ["cuit", null], ["dni", "  "], ["cuit", "11111111111"],
    ["cuit", "27-28033514-6"], ["dni", "00000000"], ["cuit", "20 12345678 6"],
  ];
  const rubrosPro = ["arquitecto", "constructora", "carpintero", "disenador", "instalador", "woodframer", "otro", "cementista", null, ""];
  const solicitudes: Record<string, unknown>[] = [];
  for (let i = 0; i < 3000; i++) {
    const [documentoTipo, documentoNumero] = uno(docs);
    solicitudes.push({
      nombre: uno([null, "", "Ab", "Ana Pérez", " Juan ", largo(120), largo(121)]),
      razonSocial: uno([undefined, "Pérez SRL", largo(160), largo(161)]),
      documentoTipo,
      documentoNumero,
      email: uno([null, "", "ana@x.com", " ANA@MJBJ.COM.AR ", "ana@x", "a b@x.com", ".a@x.com"]),
      telefono: uno([null, "", "12345", "123456", " 0223 474-3328 ", largo(40), largo(41)]),
      rubro: uno(rubrosPro),
      volumenEstimado: uno([undefined, "mucho", largo(120), largo(121)]),
      redSocial: uno([undefined, "@ana", largo(160), largo(161)]),
      mensaje: uno([undefined, "hola", largo(600), largo(601)]),
    });
  }
  escribir("form-solicitud.json", solicitudes.map((c) => ({ entrada: c, ...zodResultado(formularios.esquemaSolicitud.safeParse(c)) })));

  const aprobar: Record<string, unknown>[] = [];
  for (const id of [null, U, "x"])
    for (const priceListId of [undefined, U, "x"])
      for (const limiteCredito of [undefined, "1.500.000", "x"]) aprobar.push({ id, priceListId, limiteCredito });
  escribir("form-aprobar.json", aprobar.map((c) => ({ entrada: c, ...zodResultado(formularios.esquemaAprobar.safeParse(c)) })));
  const rechazar: Record<string, unknown>[] = [];
  for (const id of [null, U, "x"])
    for (const motivo of [null, "", "abcd", " abcd ", "abcde", largo(300), largo(301), "🌲🌲🌲"]) rechazar.push({ id, motivo });
  escribir("form-rechazar.json", rechazar.map((c) => ({ entrada: c, ...zodResultado(formularios.esquemaRechazar.safeParse(c)) })));

  // Eventos.
  const eventos: Record<string, unknown>[] = [];
  for (let i = 0; i < 2500; i++) {
    eventos.push({
      titulo: uno([null, "", "abc", "Taller", " Capacitación en wood frame ", largo(160), largo(161)]),
      resumen: uno([undefined, "r", largo(300), largo(301)]),
      descripcion: uno([undefined, "d", largo(4000), largo(4001)]),
      lugar: uno([undefined, "Sucursal Centro", largo(200), largo(201)]),
      inicia: uno([null, "", "2026-11-05T18:00", "x"]),
      termina: uno([undefined, "2026-11-05T20:00"]),
      cupo: uno([0, "", "0", "30", "30.5", "-1", "10000", "10001", "abc", " 12 ", "1e3", "0x1f", null, "Infinity"]),
      precio: uno([undefined, "1.500,50", "x"]),
      soloProfesionales: uno([true, false]),
    });
  }
  escribir("form-evento.json", eventos.map((c) => ({ entrada: c, ...zodResultado(formularios.esquemaEvento.safeParse(c)) })));
  const estados: Record<string, unknown>[] = [];
  for (const id of [null, U, "x"])
    for (const estado of [null, "borrador", "publicado", "cerrado", "cancelado", "asistio", "ausente", "confirmada", "cancelada", "otro"])
      estados.push({ id, estado });
  escribir("form-estado-evento.json", estados.map((c) => ({ entrada: c, ...zodResultado(formularios.esquemaEstadoEvento.safeParse(c)) })));
  escribir("form-asistencia.json", estados.map((c) => ({ entrada: c, ...zodResultado(formularios.esquemaAsistencia.safeParse(c)) })));
  const anotarse: Record<string, unknown>[] = [];
  for (let i = 0; i < 1500; i++)
    anotarse.push({
      eventId: uno([null, U, "x"]),
      slug: uno([null, "", "taller"]),
      nombre: uno([null, "", "Ab", "Ana Pérez", largo(120), largo(121)]),
      email: uno([null, "", "ana@x.com", "ana@x", " a@b.co "]),
      telefono: uno([undefined, "0223", largo(40), largo(41)]),
    });
  escribir("form-anotarse.json", anotarse.map((c) => ({ entrada: c, ...zodResultado(formularios.esquemaAnotarse.safeParse(c)) })));

  const titulos = ["Capacitación en Wood Frame", "  ¡Taller de Lustre! (2026)  ", "Ñandú & Cía.", "---", "", "Árbol--ñ  é", largo(100),
    "Curso: «Techos» 100% práctico", "ÀÉÎÕÜ çß", "a".repeat(79) + "-b", "🌲 Pino 🌲"];
  for (let i = 0; i < 300; i++) titulos.push(textoAlAzar());
  escribir("slugs.json", titulos.map((t) => ({ titulo: t, slug: formularios.aSlug(t) })));

  /* ------------------------------ decidirFicha ------------------------------ */
  const fichas = [];
  const candidatos = [null, { id: "A" }, { id: "A", userId: null }, { id: "A", userId: "u1" }, { id: "B" }, { id: "B", userId: "u2" }];
  for (const porCuit of candidatos)
    for (const porUsuario of candidatos)
      for (const userId of [null, "", "u1"]) fichas.push({ porCuit, porUsuario, userId, decision: decidirFicha({ porCuit, porUsuario, userId }) });
  escribir("fichas.json", fichas);

  /* ------------------------------ plantillas ------------------------------ */
  const avisos = [];
  for (const nombre of ["Ana", "Juan <x>", ""]) avisos.push({ tipo: "acuse", nombre, correo: plantillas.acuseDeRecibo(nombre) });
  for (const lista of [null, "Profesionales", "Lista <A> & B"])
    for (const limiteCredito of [0, 1, 1500000, 1234.5678, 0.5, -3])
      avisos.push({ tipo: "bienvenida", nombre: "Ana", lista, limiteCredito, correo: plantillas.bienvenida({ nombre: "Ana", lista, limiteCredito }) });
  for (const motivo of [null, "", "Falta el CUIT", "<b>x</b>"]) avisos.push({ tipo: "rechazo", nombre: "Ana", motivo, correo: plantillas.rechazo("Ana", motivo) });
  const inicios = ["2026-11-05T21:00:00Z", "2026-11-06T02:30:00Z", "2026-01-01T03:00:00Z", "2026-12-31T23:59:00Z", "2026-03-09T12:05:00Z"];
  for (const inicia of inicios)
    for (const lugar of [null, "Sucursal Centro"])
      for (const precio of [0, 15000, 1234.56]) {
        const cuando = plantillas.cuandoSeLee(new Date(inicia));
        avisos.push({
          tipo: "confirmacion", inicia, lugar, precio, cuando,
          correo: plantillas.confirmacion({ nombre: "Ana", evento: "Taller <WF>", cuando, lugar, precio, slug: "taller-wf" }),
        });
        avisos.push({
          tipo: "recordatorio", inicia, lugar, cuando,
          correo: plantillas.recordatorio({ nombre: "Ana", evento: "Taller & más", cuando, lugar, slug: "taller" }),
        });
      }
  escribir("avisos.json", avisos);

  escribir("orden-eventos.json", ORDEN_EVENTOS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
