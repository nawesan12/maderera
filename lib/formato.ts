/**
 * Formatos compartidos por todo el sitio: importes, fechas, CUIT, plurales.
 *
 * Los precios llegan desde la base como string (columna `numeric`), no como
 * number: convertirlos a punto flotante para mostrarlos abre la puerta a que
 * alguien los sume así, y los importes que terminan en una factura no se calculan
 * con floats.
 *
 * Vive en `lib/` y no en `components/admin/` porque el portal del cliente
 * necesita exactamente los mismos formatos que el panel: una fecha que se lee
 * distinto de un lado y del otro es un error que nadie reporta pero todos notan.
 */

import { aWaId } from "@/lib/whatsapp/numeros";

export const moneda = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export function formatearPrecio(valor: string | number | null): string {
  if (valor === null) return "A consultar";

  const numero = typeof valor === "string" ? Number(valor) : valor;
  if (!Number.isFinite(numero) || numero <= 0) return "A consultar";

  return moneda.format(numero);
}

/**
 * Formatea un importe cualquiera, incluidos el cero y los negativos.
 *
 * `formatearPrecio` está pensado para el catálogo, donde un precio en cero
 * significa "todavía no lo cargamos" y por eso se lee "A consultar". Un saldo
 * de cuenta corriente es otra cosa: cero quiere decir que no se debe nada, y un
 * negativo es plata a favor del cliente. Confundir las dos cosas hacía que la
 * cuenta saldada apareciera como "A consultar".
 */
export function formatearMonto(valor: string | number | null): string {
  if (valor === null) return "—";

  const numero = typeof valor === "string" ? Number(valor) : valor;
  if (!Number.isFinite(numero)) return "—";

  // Con centavos, los centavos (mes simulado): el mostrador decía «$ 203.567»
  // y la cuenta del cliente «$ 203.566,50» para la misma venta. Lo que
  // redondea a cero es «$ 0»: Intl dice «-$ 0» (mes simulado, H148).
  const centavos = Math.round(numero * 100);
  if (centavos === 0) return moneda.format(0);
  return centavos % 100 !== 0 ? monedaConCentavos.format(numero) : moneda.format(numero);
}

/**
 * La plata de la caja: los pesos enteros como `formatearMonto` y los
 * centavos solo cuando los hay («$ 50.000», «-$ 0,40»). El efectivo con el
 * descuento del 10 % deja centavos, y redondeados a pesos el arqueo escondía
 * diferencias («-$ 0» en rojo de 40 centavos que faltaban; mes simulado,
 * H164, H263 y H363). Es `formato.Importe` de Go.
 */
export function formatearImporte(valor: string | number | null): string {
  if (valor === null) return "—";
  const numero = typeof valor === "string" ? Number(valor) : valor;
  if (!Number.isFinite(numero)) return "—";
  const centavos = Math.round(numero * 100);
  if (centavos === 0) return moneda.format(0);
  return centavos % 100 === 0 ? moneda.format(centavos / 100) : monedaConCentavos.format(centavos / 100);
}

const monedaConCentavos = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const UN_DECIMAL = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * «12,5%»: un porcentaje con coma decimal y un decimal. `toFixed` ponía el
 * punto («12.5%») en Reportes y en la ficha del pedido (comité final).
 */
export function formatearPorcentaje(valor: number): string {
  return `${UN_DECIMAL.format(valor)}%`;
}

const DECIMALES = new Map<number, Intl.NumberFormat>();

/**
 * Un número con coma decimal y una cantidad fija de decimales: «4,5»,
 * «21,00». Es el `toFixed` para mostrar (hallazgo 32): `toFixed` pone el
 * punto, y en pantalla «4.5» se lee como cuatro mil quinientos.
 */
export function formatearDecimal(valor: number, decimales: number): string {
  let f = DECIMALES.get(decimales);
  if (!f) {
    f = new Intl.NumberFormat("es-AR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
    DECIMALES.set(decimales, f);
  }
  return f.format(valor);
}

/**
 * El peso de un archivo: «340 KB», «1,5 MB». Nunca «0 KB»: un archivo chico
 * es «1 KB». Sin tamaño, nada.
 */
export function formatearPeso(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${formatearDecimal(bytes / 1024 / 1024, 1)} MB`;
}

/**
 * Un importe de la base, listo para meter en un campo editable.
 *
 * No es lo mismo que `formatearMonto`: ese arma "$ 44.992,56" para leer, y eso
 * adentro de un `<input type="number">` no entra. Acá hace falta el número
 * pelado, con punto decimal y **como mucho dos decimales**.
 *
 * Existe porque los costos se guardan en `numeric(12,4)` —un costo promedio
 * ponderado necesita esa precisión para no derivar redondeo tras redondeo— y
 * el driver los devuelve tal cual: el campo mostraba `44992.5600`, que hay que
 * leer dos veces para saber si dice cuarenta y cuatro mil o cuatro millones, y
 * que invita a borrar de más al corregirlo.
 *
 * El cero de más también se saca: `19200.0000` es `19200`, no `19200.00`.
 */
export function importeParaEditar(valor: string | number | null): string {
  if (valor === null || valor === "") return "";

  const numero = typeof valor === "string" ? Number(valor) : valor;
  if (!Number.isFinite(numero)) return "";

  // `toFixed` y no un redondeo a mano: con dos decimales el error de coma
  // flotante no llega a cambiar el centavo.
  return String(Number(numero.toFixed(2)));
}

/* -------------------------------------------------------------------------- */
/* Fechas                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * La zona de las horas que se muestran. El contenedor de Next corre en UTC, y
 * sin zona explícita toda hora armada en el servidor salía 3 h adelantada (y
 * distinta de la que arma el navegador al hidratar). `fechaHora` y `hora`
 * siempre son instantes; `fechaCorta` y `fechaLarga` distinguen los días
 * guardados a medianoche UTC (ver `fechaSegunTipo`).
 */
export const ZONA = "America/Argentina/Buenos_Aires";

/**
 * Un día guardado como día: medianoche UTC exacta (así guardan las fechas que
 * se cargan en un formulario, «2026-10-15»). Un instante real no cae nunca
 * justo ahí.
 */
function esDia(fecha: Date): boolean {
  return (
    fecha.getUTCHours() === 0 &&
    fecha.getUTCMinutes() === 0 &&
    fecha.getUTCSeconds() === 0 &&
    fecha.getUTCMilliseconds() === 0
  );
}

/**
 * Una fecha que sale bien sea un día o un instante: el día se lee en UTC (si
 * no, en la Argentina sale el anterior) y el instante en hora argentina (si
 * no, el servidor, que corre en UTC, ponía mañana a todo lo de después de las
 * 21).
 */
function fechaSegunTipo(opciones: Intl.DateTimeFormatOptions) {
  const comoDia = new Intl.DateTimeFormat("es-AR", { ...opciones, timeZone: "UTC" });
  const comoInstante = new Intl.DateTimeFormat("es-AR", { ...opciones, timeZone: ZONA });
  return {
    format: (fecha: Date | number) => {
      const d = typeof fecha === "number" ? new Date(fecha) : fecha;
      return (esDia(d) ? comoDia : comoInstante).format(d);
    },
  };
}

export const fechaCorta = fechaSegunTipo({ day: "2-digit", month: "2-digit", year: "2-digit" });

export const fechaLarga = fechaSegunTipo({ day: "numeric", month: "long", year: "numeric" });

export const fechaHora = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const hora = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "hace 3 días", para listados donde la fecha exacta no aporta. */
export function haceCuanto(fecha: Date | null): string {
  if (!fecha) return "—";

  const minutos = Math.round((Date.now() - fecha.getTime()) / 60000);
  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;

  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;

  const dias = Math.round(horas / 24);
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;

  const meses = Math.round(dias / 30);
  return meses === 1 ? "hace un mes" : `hace ${meses} meses`;
}

/**
 * Días que faltan para una fecha. Negativo si ya pasó.
 *
 * Un día guardado como día (un vencimiento: medianoche UTC) se cuenta contra
 * el día de hoy en la Argentina, no contra la hora: restando horas, una
 * factura que vencía hoy pasaba a «hace 1 día» desde las 21.
 */
export function diasHasta(fecha: Date | null, ahora: Date = new Date()): number | null {
  if (!fecha) return null;
  if (esDia(fecha)) {
    const hoy = Date.parse(`${hoyEnArgentina(ahora)}T00:00:00Z`);
    return Math.round((fecha.getTime() - hoy) / 86_400_000);
  }
  return Math.ceil((fecha.getTime() - ahora.getTime()) / 86_400_000);
}

/* -------------------------------------------------------------------------- */
/* Texto                                                                       */
/* -------------------------------------------------------------------------- */

/** CUIT guardado sin guiones, mostrado como se lee. */
export function formatearCuit(cuit: string | null): string {
  if (!cuit) return "—";
  const limpio = cuit.replace(/\D/g, "");
  if (limpio.length !== 11) return cuit;
  return `${limpio.slice(0, 2)}-${limpio.slice(2, 10)}-${limpio.slice(10)}`;
}

/**
 * El documento con su nombre: «CUIT 30-71234567-8», «DNI 30.111.222».
 *
 * Se decidía por el largo del texto guardado, y un CUIT con guiones (13
 * caracteres) salía «DNI 30-71234567-8», al lado de otro sin guiones
 * («CUIT 20301112220»; mes simulado). Se cuentan los dígitos.
 */
export function documentoConTipo(documento: string): string {
  const digitos = documento.replace(/\D/g, "");
  if (digitos.length === 11) return `CUIT ${formatearCuit(digitos)}`;
  if (digitos.length >= 7 && digitos.length <= 8) return `DNI ${Number(digitos).toLocaleString("es-AR")}`;
  return documento;
}

/**
 * Unidad de venta como se dice en el mostrador.
 *
 * En la base se guarda `metro_cuadrado` porque la calculadora, el carrito y la
 * factura tienen que hablar el mismo idioma sin ambigüedad. Pero al cliente se
 * le muestra "m²": nadie pide quince metro_cuadrado de machimbre.
 *
 * **Tiene que cubrir todo `unitOfSale` de `lib/db/schema/catalog.ts`.** Le
 * faltaban cuatro —entre ellas **tabla**, la del deck— y la del kilo estaba
 * escrita `kilo` cuando el enum dice `kg`: las cinco caían al respaldo y salían
 * a la pantalla como las guarda la base. `tests/formato.test.ts` lo vigila.
 * Tenía además `metro_cubico` y `bolsa`, que no existen en el enum: se sacaron
 * el 1/10/2026 para que este mapa diga exactamente lo mismo que la base.
 */
export const ABREVIATURA_UNIDAD: Record<string, string> = {
  unidad: "u.",
  metro_lineal: "ml",
  metro_cuadrado: "m²",
  tabla: "tabla",
  placa: "placa",
  rollo: "rollo",
  par: "par",
  juego: "juego",
  kg: "kg",
  litro: "l",
};

export function formatearUnidad(unidad: string | null): string {
  if (!unidad) return "u.";
  return ABREVIATURA_UNIDAD[unidad] ?? unidad.replace(/_/g, " ");
}

/** La unidad en plural: «placas», «rollos», «pares»; lo abreviado no cambia. */
export function unidadEnPlural(unidad: string): string {
  if (/[.²\s]/.test(unidad) || unidad.length <= 2 || /s$/i.test(unidad)) return unidad;
  return /[aeiouáéíóú]$/i.test(unidad) ? `${unidad}s` : `${unidad}es`;
}

const cantidadLegible = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });

/**
 * La cantidad con su unidad, concordada: «1 placa», «25 placas», «20 u.»,
 * «2,5 m²». Se leía «Quedan 25 placa» y «4 rollo» en las entregas y «3 placa»
 * en el papel del cliente (mes simulado, H095). Sin unidad, la cifra sola.
 */
export function cantidadConUnidad(cantidad: number, unidad: string | null): string {
  const n = cantidadLegible.format(cantidad);
  if (!unidad) return n;
  // La línea del corte se cobra por pasada de la sierra; en el papel del
  // cliente es «4 cortes», al lado de «Corte a medida · 3 piezas»: la
  // cantidad sola no se entendía (simulación del mes, H145).
  if (unidad === "pasada") return `${n} ${cantidad === 1 ? "corte" : "cortes"}`;
  const u = formatearUnidad(unidad);
  return `${n} ${cantidad === 1 ? u : unidadEnPlural(u)}`;
}

/** Pluraliza sin que quede "1 ítems". */
export function plural(
  cantidad: number,
  singular: string,
  pluralForma?: string,
): string {
  return `${cantidad} ${cantidad === 1 ? singular : (pluralForma ?? singular + "s")}`;
}

/**
 * Fecha sin hora, formateada en UTC.
 *
 * Para fechas que representan un día y no un instante —inicio de actividades,
 * vencimiento del CAE— hay que leerlas en UTC. Con el formateador local, un
 * `1981-03-01` guardado a medianoche UTC se muestra como 28/02 en Argentina,
 * que está tres horas atrás.
 */
export const fechaSolaCorta = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  timeZone: "UTC",
});

/**
 * El día de hoy en Argentina, como `aaaa-mm-dd` (el valor de un `<input
 * type="date">`). `new Date().toISOString().slice(0, 10)` da el día UTC:
 * desde las 21 dice mañana, y un gasto cargado a la noche quedaba fechado
 * al día siguiente.
 */
export function hoyEnArgentina(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(ahora);
}

/**
 * Convierte a número un importe tipeado por una persona.
 *
 * Hay que aceptar las formas en que se escribe un precio, porque todas llegan:
 * "528300.00" desde un campo numérico del navegador, "528.300,50" como lo
 * escribe alguien en Argentina, y "1.500.000" cuando se tipea a mano sin
 * decimales.
 *
 * Tres reglas, en orden:
 *
 * 1. **Con coma**, la coma es el decimal y los puntos son de miles.
 * 2. **Sin coma y con más de un punto**, todos los puntos son de miles: no hay
 *    ninguna notación decimal con dos puntos.
 * 3. **Sin coma, con un solo punto y exactamente tres cifras después**, el
 *    punto es de miles: «250.000» son doscientos cincuenta mil pesos.
 * 4. **Sin coma y con un solo punto**, en cualquier otro caso, el punto es
 *    decimal y se deja como está.
 *
 * La cuarta regla es la que no se puede relajar: el error opuesto ya ocurrió,
 * y quitar todos los puntos siempre convertía un cobro de $528.300 en uno de
 * $52.830.000, con la factura dada por cobrada de más. Lo que llega del
 * navegador —«528300.00», «1234.5»— nunca trae tres decimales: un importe en
 * pesos tiene dos. La tercera regla se agregó el 1/10/2026, cuando un cheque
 * de «250.000» tipeado a mano se cargó por $250 en el cobro multimedio.
 */
export function parsearImporte(texto: string): number {
  // El signo y la moneda se escriben («$ 420.000,50», «ARS 20.000») y no
  // cambian el número: se sacan antes de leer.
  const limpio = texto
    .replace(/\$|\bars\b/gi, "")
    .trim()
    .replace(/\s/g, "");
  if (!limpio) return NaN;

  if (limpio.includes(",")) {
    return Number(limpio.replace(/\./g, "").replace(",", "."));
  }

  const puntos = (limpio.match(/\./g) ?? []).length;
  if (puntos > 1) return Number(limpio.replace(/\./g, ""));
  if (puntos === 1 && /^-?\d{1,3}\.\d{3}$/.test(limpio)) {
    return Number(limpio.replace(".", ""));
  }

  return Number(limpio);
}

/**
 * Lo que vale un campo de plata (`type="text"` con `inputMode="decimal"`),
 * leído con `parsearImporte`: «15.000» son quince mil y «1.234,56», mil
 * doscientos treinta y cuatro con cincuenta y seis. Vacío o ilegible es 0,
 * como el `Number(x) || 0` que reemplaza (comité final, M13: con
 * `type="number"` y `Number()`, «15.000» se guardaba como $15).
 */
export function importeDelCampo(texto: string | null | undefined): number {
  const n = parsearImporte(texto ?? "");
  return Number.isFinite(n) ? n : 0;
}

/**
 * Si lo escrito en un campo de plata no se entiende como importe. Vacío no es
 * ilegible (es cero); «12,5,3» o «abc» sí. El formulario lo marca con
 * `aria-invalid`, lo dice junto al campo y no deja mandar: antes se tomaba
 * como $0 sin avisar.
 */
export function importeIlegible(texto: string | null | undefined): boolean {
  if (!texto || !texto.trim()) return false;
  const n = parsearImporte(texto);
  return !Number.isFinite(n);
}

const IMPORTE_DEL_CAMPO = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
  useGrouping: true,
});

/**
 * Un importe listo para precargar un campo de plata, como lo escribe una
 * persona: 15000 → «15.000», 1234.5 → «1.234,5». `importeDelCampo` lo lee de
 * vuelta igual. Antes se precargaba con `toFixed(2)` («1234.50», con punto).
 */
export function importeParaElCampo(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const n = typeof valor === "string" ? Number(valor) : valor;
  if (!Number.isFinite(n)) return "";
  return IMPORTE_DEL_CAMPO.format(Number(n.toFixed(2)));
}

/**
 * El nombre de pila, para saludar.
 *
 * Salta el título profesional. Las fichas del mostrador vienen cargadas como
 * "Arq. Carolina Méndez" o "Ing. Silvia Roldán", y quedarse con la primera
 * palabra saludaba "Hola, Arq.". Se veía en el portal, en el navbar y —lo peor—
 * en las plantillas de WhatsApp, que son mensajes que salen para afuera.
 *
 * Si después del título no queda nada, devuelve el nombre entero: es preferible
 * un saludo formal a uno vacío.
 */
const TITULOS = new Set([
  "arq", "ing", "lic", "dr", "dra", "sr", "sra", "srta", "cont", "tec", "téc",
  "prof", "mg", "esc", "cr", "cra",
]);

export function primerNombre(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";

  const sinTitulo = partes.filter(
    (p) => !TITULOS.has(p.replace(/\.$/, "").toLowerCase()),
  );

  return sinTitulo[0] ?? partes[0];
}

/**
 * Un teléfono listo para un enlace `tel:`.
 *
 * Deja solo dígitos y el `+` inicial: "(0223) 474-3328" queda "02234743328".
 * Estaba repetido como `.replace(/[^\d+]/g, "")` en el menú, el pie, contacto,
 * sucursales y el portal de profesionales, que es la clase de duplicación que
 * después hace que uno de los cinco quede sin arreglar.
 */
export function telefonoParaMarcar(telefono: string): string {
  return telefono.replace(/[^\d+]/g, "");
}

/**
 * El número como lo quiere `wa.me`: internacional, sin signos, con el 9.
 *
 * **El 9 es el detalle que rompe todo.** Argentina exige `54` + `9` + área +
 * número para los celulares; sin el nueve, WhatsApp abre una conversación con
 * un número que no existe y el aviso nunca llega. Los teléfonos se cargan como
 * los dicta la gente —"0223 15-5544332", "223 554-4332"— así que hay que sacar
 * el cero de larga distancia y el quince, que son notación local y no parte del
 * número.
 *
 * Estaba escrito en dos lugares y en los dos mal de distinta manera: la ficha
 * del cliente ponía `54` sin el nueve, y la lista no ponía prefijo ninguno. Es
 * la misma clase de error que este proyecto ya tuvo con las reglas de acceso:
 * una regla en dos lados y uno de los dos atrasado.
 */
export function whatsappDestino(telefono: string): string {
  // La regla completa vive en `lib/whatsapp/numeros.ts` (la usan la bandeja y
  // el botón «Avisar por WhatsApp»): este enlace tiene que dar el mismo número.
  // Lo de abajo queda para lo que esa regla no reconoce.
  const reconocido = aWaId(telefono);
  if (reconocido) return reconocido;

  let n = telefono.replace(/\D/g, "");

  if (n.startsWith("549")) return n;
  // Ya trae el país pero no el nueve de celular.
  if (n.startsWith("54")) return `549${n.slice(2)}`;

  // Notación local: el 0 de larga distancia y el 15 del celular no viajan.
  if (n.startsWith("0")) n = n.slice(1);
  n = n.replace(/^(\d{2,4})15(\d{6,8})$/, "$1$2");

  return `549${n}`;
}

/** El enlace completo, con el mensaje ya escrito si se le pasa uno. */
export function enlaceDeWhatsapp(telefono: string, mensaje?: string): string {
  const base = `https://wa.me/${whatsappDestino(telefono)}`;
  return mensaje ? `${base}?text=${encodeURIComponent(mensaje)}` : base;
}

/** Días enteros desde una fecha hasta hoy. */
export function diasDesde(fecha: Date): number {
  return Math.max(0, Math.floor((Date.now() - fecha.getTime()) / 86_400_000));
}

/**
 * Si la lista se está mirando con un filtro o una búsqueda (lo que no es la
 * página ni un «todos»). Sirve para separar «ningún resultado coincide» del
 * vacío de verdad, que tiene que decir cómo empezar.
 */
export function hayFiltro(params: Record<string, string | string[] | undefined>): boolean {
  return Object.entries(params).some(
    ([clave, valor]) =>
      clave !== "pagina" &&
      typeof valor === "string" &&
      valor.trim() !== "" &&
      valor !== "todos" &&
      valor !== "todas",
  );
}
