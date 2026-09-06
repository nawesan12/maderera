/**
 * Qué se puede migrar desde el sistema anterior, y cómo se lee cada columna.
 *
 * El módulo entero está escrito **sin conocer el archivo de Quality Software**,
 * y eso no es una limitación sino la decisión de diseño: en vez de programar
 * contra un formato que todavía no vimos, se declara qué necesita cada tabla
 * de destino y la pantalla pide que alguien diga qué columna del archivo
 * corresponde a cada cosa. El día que llegue la exportación no hay que tocar
 * código; hay que mapear seis columnas en una pantalla.
 *
 * `alias` es lo que hace que ese mapeo salga hecho la primera vez: son los
 * nombres con los que un sistema de escritorio argentino suele llamar a cada
 * campo. Cuando alguno no coincide, se corrige a mano y listo.
 *
 * Todo lo de este archivo es lógica pura, sin base de datos: la vista previa
 * puede validar el archivo completo sin escribir nada.
 */

import { cuitValido, soloDigitos } from "@/lib/cuit";
import { interpretarNumero, normalizarEncabezado } from "@/lib/csv";

export type ClaveEntidad =
  | "clientes"
  | "productos"
  | "stock"
  | "saldos"
  | "proveedores"
  | "ventas_historicas"
  | "comprobantes_historicos";

/**
 * Filas por lote.
 *
 * Doscientas es lo que se aplica en menos del tiempo máximo de una acción del
 * servidor incluso con las consultas fila por fila, y lo que mantiene cada
 * transacción lo bastante corta como para no bloquear a nadie más mientras
 * corre. La pantalla parte el archivo con esta medida y va mostrando el avance.
 */
export const LOTE = 200;

export type TipoCampo =
  | "texto"
  | "numero"
  | "entero"
  | "cuit"
  | "email"
  | "opcion"
  | "fecha";

export interface OpcionCampo {
  valor: string;
  etiqueta: string;
  /** Cómo lo escribe el sistema viejo. Se comparan normalizados. */
  alias: string[];
}

export interface CampoDestino {
  clave: string;
  etiqueta: string;
  tipo: TipoCampo;
  requerido?: boolean;
  ayuda?: string;
  opciones?: OpcionCampo[];
  /** Valor que se usa cuando la columna no está mapeada o viene vacía. */
  porDefecto?: string;
  alias: string[];
}

export interface DefinicionEntidad {
  clave: ClaveEntidad;
  titulo: string;
  resumen: string;
  /** En qué tablas escribe, en palabras. Se muestra antes de ejecutar. */
  escribe: string;
  /** Cómo se reconoce un registro ya migrado, para no duplicarlo al repetir. */
  identidad: string;
  campos: CampoDestino[];
}

/* -------------------------------------------------------------------------- */
/* Opciones compartidas                                                        */
/* -------------------------------------------------------------------------- */

const CONDICIONES_IVA: OpcionCampo[] = [
  {
    valor: "responsable_inscripto",
    etiqueta: "Responsable inscripto",
    alias: ["responsableinscripto", "respinscripto", "respinsc", "ri", "inscripto", "responsable", "1"],
  },
  {
    valor: "monotributista",
    etiqueta: "Monotributista",
    alias: ["monotributista", "monotributo", "respmonotributo", "mt", "responsablemonotributo"],
  },
  { valor: "exento", etiqueta: "Exento", alias: ["exento", "ex", "e"] },
  {
    valor: "consumidor_final",
    etiqueta: "Consumidor final",
    alias: ["consumidorfinal", "cf", "final", "consumidor", "5"],
  },
  {
    valor: "no_categorizado",
    etiqueta: "No categorizado",
    alias: ["nocategorizado", "sincategoria", "nc", "sinclasificar"],
  },
];

const UNIDADES: OpcionCampo[] = [
  { valor: "unidad", etiqueta: "Unidad", alias: ["unidad", "u", "un", "cu", "cadauno", "pieza", "pza"] },
  { valor: "metro_lineal", etiqueta: "Metro lineal", alias: ["metrolineal", "ml", "metro", "metros", "m", "mlineal", "lineal", "lineales"] },
  { valor: "metro_cuadrado", etiqueta: "Metro cuadrado", alias: ["metrocuadrado", "m2", "mtscuadrados", "metros2", "cuadrado", "cuadrados"] },
  { valor: "placa", etiqueta: "Placa", alias: ["placa", "pl", "tablero", "chapa"] },
  { valor: "rollo", etiqueta: "Rollo", alias: ["rollo", "ro"] },
  { valor: "par", etiqueta: "Par", alias: ["par", "pares"] },
  { valor: "juego", etiqueta: "Juego", alias: ["juego", "jgo", "set", "kit"] },
  { valor: "kg", etiqueta: "Kilogramo", alias: ["kg", "kilo", "kilos", "kilogramo"] },
  { valor: "litro", etiqueta: "Litro", alias: ["litro", "litros", "lt", "l"] },
];

const TIPOS_CLIENTE: OpcionCampo[] = [
  {
    valor: "particular",
    etiqueta: "Particular",
    alias: ["particular", "consumidor", "minorista", "publico", "comun"],
  },
  {
    valor: "profesional",
    etiqueta: "Profesional",
    alias: ["profesional", "mayorista", "gremio", "constructor", "carpintero", "arquitecto", "empresa"],
  },
];

/* -------------------------------------------------------------------------- */
/* Las siete entidades                                                         */
/* -------------------------------------------------------------------------- */

export const ENTIDADES: DefinicionEntidad[] = [
  {
    clave: "clientes",
    titulo: "Clientes",
    resumen:
      "La cartera del mostrador: nombre, CUIT, contacto y condición frente al IVA.",
    escribe: "Crea o actualiza fichas en Clientes. No toca cuentas corrientes.",
    identidad:
      "El código del sistema anterior. Si falta, el CUIT. Si tampoco hay, el nombre exacto.",
    campos: [
      {
        clave: "codigo",
        etiqueta: "Código en el sistema anterior",
        tipo: "texto",
        alias: ["codigo", "cod", "codcliente", "codigocliente", "nrocliente", "numerocliente", "idcliente", "id", "nro"],
        ayuda:
          "Es lo que permite volver a correr la migración sin duplicar nada, y lo que después ata los saldos a cada ficha.",
      },
      {
        clave: "nombre",
        etiqueta: "Nombre",
        tipo: "texto",
        requerido: true,
        alias: ["nombre", "cliente", "nombrecliente", "apellidoynombre", "denominacion", "razonsocial", "nombrefantasia"],
      },
      {
        clave: "razonSocial",
        etiqueta: "Razón social",
        tipo: "texto",
        alias: ["razonsocial", "razon", "denominacionfiscal"],
      },
      {
        clave: "cuit",
        etiqueta: "CUIT",
        tipo: "cuit",
        alias: ["cuit", "cuil", "cuitcuil", "documento", "nrodocumento", "dni"],
      },
      {
        clave: "condicionIva",
        etiqueta: "Condición frente al IVA",
        tipo: "opcion",
        opciones: CONDICIONES_IVA,
        porDefecto: "consumidor_final",
        alias: ["condicioniva", "condiva", "iva", "condicion", "condicionfiscal", "situacioniva", "sitiva", "categoriaiva", "categfiscal", "tipoiva"],
      },
      {
        clave: "email",
        etiqueta: "Correo",
        tipo: "email",
        alias: ["email", "mail", "correo", "correoelectronico", "emailcliente"],
      },
      {
        clave: "telefono",
        etiqueta: "Teléfono",
        tipo: "texto",
        alias: ["telefono", "tel", "celular", "movil", "contacto", "telefonos"],
      },
      {
        clave: "direccion",
        etiqueta: "Domicilio",
        tipo: "texto",
        alias: ["direccion", "domicilio", "calle", "domiciliofiscal", "direccionfiscal"],
      },
      {
        clave: "tipo",
        etiqueta: "Tipo de cliente",
        tipo: "opcion",
        opciones: TIPOS_CLIENTE,
        porDefecto: "particular",
        alias: ["tipo", "tipocliente", "clase", "categoria", "segmento"],
      },
      {
        clave: "limiteCredito",
        etiqueta: "Límite de cuenta corriente",
        tipo: "numero",
        porDefecto: "0",
        alias: ["limitecredito", "limite", "creditomaximo", "topecuentacorriente", "limitecuentacorriente"],
      },
      {
        clave: "asesor",
        etiqueta: "Vendedor asignado",
        tipo: "texto",
        alias: ["asesor", "vendedor", "responsable", "vendedorasignado"],
      },
      {
        clave: "notas",
        etiqueta: "Observaciones",
        tipo: "texto",
        alias: ["notas", "observaciones", "comentarios", "obs"],
      },
    ],
  },
  {
    clave: "productos",
    titulo: "Productos y medidas",
    resumen:
      "El catálogo: un renglón por código. Los renglones con el mismo nombre y categoría quedan como medidas de un mismo producto.",
    escribe:
      "Crea o actualiza productos, medidas y —si vienen las columnas— los precios de lista general y profesional.",
    identidad: "El código (SKU) de cada medida.",
    campos: [
      {
        clave: "sku",
        etiqueta: "Código / SKU",
        tipo: "texto",
        requerido: true,
        alias: ["sku", "codigo", "cod", "codigoarticulo", "codarticulo", "codproducto", "articulo", "idarticulo"],
      },
      {
        clave: "nombre",
        etiqueta: "Nombre del producto",
        tipo: "texto",
        requerido: true,
        alias: ["nombre", "descripcion", "producto", "detalle", "denominacion", "descripcionarticulo"],
        ayuda:
          "Sin la medida. Dos renglones con el mismo nombre y la misma categoría se agrupan en un producto con dos medidas.",
      },
      {
        clave: "categoria",
        etiqueta: "Categoría",
        tipo: "texto",
        requerido: true,
        alias: ["categoria", "rubro", "familia", "grupo", "linea", "seccion"],
        ayuda: "Si la categoría no existe en el catálogo, se crea.",
      },
      {
        clave: "medida",
        etiqueta: "Medida",
        tipo: "texto",
        alias: ["medida", "medidas", "variante", "presentacion", "dimension", "dimensiones", "tamano"],
        ayuda: 'Lo que ve el cliente: 2" x 4" x 3.60m. Si no viene, se usa el código.',
      },
      {
        clave: "unidad",
        etiqueta: "Unidad de venta",
        tipo: "opcion",
        opciones: UNIDADES,
        porDefecto: "unidad",
        alias: ["unidad", "unidadmedida", "um", "unidadventa", "unidaddeventa"],
      },
      {
        clave: "marca",
        etiqueta: "Marca",
        tipo: "texto",
        alias: ["marca", "fabricante", "proveedor"],
      },
      {
        clave: "descripcion",
        etiqueta: "Descripción larga",
        tipo: "texto",
        alias: ["descripcionlarga", "detallelargo", "observaciones", "comentario"],
      },
      {
        clave: "precioGeneral",
        etiqueta: "Precio de lista",
        tipo: "numero",
        alias: ["precio", "preciolista", "preciogeneral", "preciopublico", "pvp", "preciounitario", "preciodeventa"],
      },
      {
        clave: "precioProfesional",
        etiqueta: "Precio profesional",
        tipo: "numero",
        alias: ["precioprofesional", "precioprof", "preciomayorista", "preciogremio", "precioespecial", "precio2"],
      },
      {
        clave: "alicuotaIva",
        etiqueta: "Alícuota de IVA",
        tipo: "numero",
        porDefecto: "21",
        alias: ["alicuota", "alicuotaiva", "iva", "porcentajeiva"],
      },
      {
        clave: "largoMm",
        etiqueta: "Largo (mm)",
        tipo: "entero",
        alias: ["largo", "largomm", "longitud"],
        ayuda: "Sale en la ficha técnica del producto, en Medidas disponibles.",
      },
      { clave: "anchoMm", etiqueta: "Ancho (mm)", tipo: "entero", alias: ["ancho", "anchomm"] },
      { clave: "espesorMm", etiqueta: "Espesor (mm)", tipo: "entero", alias: ["espesor", "espesormm", "alto", "altura"] },
    ],
  },
  {
    clave: "stock",
    titulo: "Existencias",
    resumen:
      "Las cantidades por sucursal con las que arranca el sistema nuevo. Se corre después de los productos.",
    escribe:
      "Ajusta el stock físico de cada medida y deja el movimiento en el libro, con el motivo.",
    identidad:
      "Código de medida y sucursal. Volver a correrlo deja la existencia en el número del archivo, no la suma.",
    campos: [
      {
        clave: "sku",
        etiqueta: "Código / SKU",
        tipo: "texto",
        requerido: true,
        alias: ["sku", "codigo", "cod", "codigoarticulo", "codarticulo", "articulo", "idarticulo"],
      },
      {
        clave: "sucursal",
        etiqueta: "Sucursal",
        tipo: "texto",
        requerido: true,
        alias: ["sucursal", "deposito", "almacen", "local", "planta", "branch"],
        ayuda: "Se busca por nombre. Tiene que existir en Sucursales.",
      },
      {
        clave: "cantidad",
        etiqueta: "Existencia",
        tipo: "entero",
        requerido: true,
        alias: ["cantidad", "stock", "existencia", "existencias", "qty", "saldo", "disponible"],
      },
      {
        clave: "minimo",
        etiqueta: "Mínimo de reposición",
        tipo: "entero",
        alias: ["minimo", "stockminimo", "puntoreposicion", "min", "reposicion"],
      },
    ],
  },
  {
    clave: "saldos",
    titulo: "Saldos de cuenta corriente",
    resumen:
      "Lo que cada cliente debe al día del corte. Se corre después de los clientes y una sola vez.",
    escribe:
      "Carga un movimiento de ajuste por cliente, con el detalle «Saldo inicial migrado».",
    identidad:
      "El movimiento de saldo inicial de cada cliente. Si ya lo tiene, la fila se omite en vez de sumar de nuevo.",
    campos: [
      {
        clave: "codigo",
        etiqueta: "Código del cliente",
        tipo: "texto",
        alias: ["codigo", "cod", "codcliente", "codigocliente", "nrocliente", "idcliente", "id"],
        ayuda: "El mismo con el que se migraron los clientes. Es la forma más segura de encontrarlos.",
      },
      {
        clave: "cuit",
        etiqueta: "CUIT",
        tipo: "cuit",
        alias: ["cuit", "cuil", "cuitcuil", "documento"],
      },
      {
        clave: "email",
        etiqueta: "Correo",
        tipo: "email",
        alias: ["email", "mail", "correo", "correoelectronico"],
      },
      {
        clave: "nombre",
        etiqueta: "Nombre del cliente",
        tipo: "texto",
        alias: ["nombre", "cliente", "razonsocial", "apellidoynombre"],
        ayuda: "Solo para poder leer el informe. No se usa para buscar la ficha.",
      },
      {
        clave: "saldo",
        etiqueta: "Saldo",
        tipo: "numero",
        requerido: true,
        alias: ["saldo", "saldoactual", "deuda", "importe", "saldocuentacorriente", "total"],
        ayuda:
          "Positivo es lo que el cliente debe. Negativo —o entre paréntesis— es saldo a favor.",
      },
      {
        clave: "detalle",
        etiqueta: "Detalle",
        tipo: "texto",
        alias: ["detalle", "observaciones", "concepto", "comentario"],
      },
    ],
  },
  {
    clave: "proveedores",
    titulo: "Proveedores",
    resumen:
      "La cartera de proveedores con sus datos fiscales. Se puede correr en cualquier momento; no depende de nada.",
    escribe:
      "Crea o actualiza la ficha del proveedor y, si viene saldo, deja un movimiento de saldo inicial en su cuenta corriente.",
    identidad:
      "El código del sistema anterior, o el CUIT si no hay código. Volver a correr el archivo actualiza la ficha en vez de duplicarla.",
    campos: [
      {
        clave: "codigo",
        etiqueta: "Código del proveedor",
        tipo: "texto",
        alias: ["codigo", "cod", "codproveedor", "codigoproveedor", "nroproveedor", "idproveedor", "id"],
        ayuda: "El del sistema viejo. Es lo que permite volver a subir el archivo sin duplicar la cartera.",
      },
      {
        clave: "nombre",
        etiqueta: "Nombre",
        tipo: "texto",
        requerido: true,
        alias: ["nombre", "proveedor", "razonsocial", "nombreproveedor", "descripcion"],
      },
      {
        clave: "cuit",
        etiqueta: "CUIT",
        tipo: "cuit",
        alias: ["cuit", "cuil", "cuitcuil", "documento"],
      },
      {
        clave: "condicionIva",
        etiqueta: "Condición frente al IVA",
        tipo: "opcion",
        opciones: CONDICIONES_IVA,
        porDefecto: "responsable_inscripto",
        alias: ["condicioniva", "condicion", "iva", "situacioniva", "tipoiva", "categoria"],
      },
      {
        clave: "email",
        etiqueta: "Correo",
        tipo: "email",
        alias: ["email", "mail", "correo", "correoelectronico"],
      },
      {
        clave: "telefono",
        etiqueta: "Teléfono",
        tipo: "texto",
        alias: ["telefono", "tel", "celular", "movil", "contacto"],
      },
      {
        clave: "direccion",
        etiqueta: "Domicilio",
        tipo: "texto",
        alias: ["direccion", "domicilio", "calle", "domiciliofiscal"],
      },
      {
        clave: "saldo",
        etiqueta: "Saldo",
        tipo: "numero",
        alias: ["saldo", "saldoactual", "deuda", "saldocuentacorriente"],
        ayuda: "Positivo es lo que le debemos al proveedor. Si viene vacío no se carga ningún movimiento.",
      },
      {
        clave: "notas",
        etiqueta: "Observaciones",
        tipo: "texto",
        alias: ["notas", "observaciones", "comentario", "detalle"],
      },
    ],
  },
  {
    clave: "ventas_historicas",
    titulo: "Histórico de ventas",
    resumen:
      "Las ventas del sistema anterior, para poder consultarlas. Se corre después de los clientes.",
    escribe:
      "Escribe en el archivo histórico, que es de solo lectura. No crea pedidos: no mueve stock ni entra en ninguna cola de trabajo.",
    identidad:
      "El número de comprobante del sistema viejo. Volver a correr el archivo actualiza la fila en vez de duplicarla.",
    campos: [
      {
        clave: "comprobante",
        etiqueta: "Número de comprobante",
        tipo: "texto",
        requerido: true,
        alias: ["comprobante", "numero", "nrocomprobante", "numerocomprobante", "factura", "nrofactura", "documento", "nro"],
        ayuda: "Cómo lo identificaba el sistema viejo. Es lo que evita cargar la misma venta dos veces.",
      },
      {
        clave: "fecha",
        etiqueta: "Fecha",
        tipo: "fecha",
        requerido: true,
        alias: ["fecha", "fechacomprobante", "fechaventa", "fechaemision", "emision"],
        ayuda: "Día/mes/año, como lo escribe el sistema viejo.",
      },
      {
        clave: "codigoCliente",
        etiqueta: "Código del cliente",
        tipo: "texto",
        alias: ["codigocliente", "codcliente", "cliente", "nrocliente", "idcliente", "codigo"],
        ayuda: "El mismo con el que se migraron los clientes. Sin esto la venta queda sin ficha asociada.",
      },
      {
        clave: "clienteNombre",
        etiqueta: "Nombre del cliente",
        tipo: "texto",
        alias: [
          "nombrecliente",
          "razonsocial",
          "cliente",
          "nombre",
          "apellidoynombre",
        ],
      },
      {
        clave: "total",
        etiqueta: "Total",
        tipo: "numero",
        requerido: true,
        alias: ["total", "importe", "importetotal", "monto", "totalventa"],
      },
      {
        clave: "detalle",
        etiqueta: "Detalle",
        tipo: "texto",
        alias: ["detalle", "descripcion", "concepto", "articulos", "observaciones"],
        ayuda: "Se guarda tal como viene, sin partirlo en renglones.",
      },
      {
        clave: "sucursal",
        etiqueta: "Sucursal",
        tipo: "texto",
        alias: ["sucursal", "deposito", "local", "punto", "puntoventa"],
      },
      {
        clave: "vendedor",
        etiqueta: "Vendedor",
        tipo: "texto",
        alias: ["vendedor", "asesor", "usuario", "operador"],
      },
    ],
  },
  {
    clave: "comprobantes_historicos",
    titulo: "Comprobantes emitidos",
    resumen:
      "Las facturas y notas que ya emitió el sistema anterior. Se corre después de los clientes.",
    escribe:
      "Escribe en el archivo histórico. **No toca la numeración fiscal nueva**: los comprobantes que emita esta plataforma siguen su propia serie.",
    identidad:
      "Punto de venta, tipo y número. Volver a correr el archivo actualiza la fila en vez de duplicarla.",
    campos: [
      {
        clave: "puntoVenta",
        etiqueta: "Punto de venta",
        tipo: "entero",
        requerido: true,
        alias: ["puntoventa", "ptovta", "pv", "punto", "sucursal", "boca"],
      },
      {
        clave: "tipo",
        etiqueta: "Tipo de comprobante",
        tipo: "texto",
        requerido: true,
        alias: ["tipo", "tipocomprobante", "comprobante", "letra", "clase"],
        ayuda: "Se guarda tal como lo escribe el sistema viejo (\"Factura A\", \"FA\", \"NC B\"). No se reinterpreta: es un dato fiscal ya registrado en ARCA.",
      },
      {
        clave: "numero",
        etiqueta: "Número",
        tipo: "entero",
        requerido: true,
        alias: ["numero", "nro", "nrocomprobante", "numerocomprobante", "correlativo"],
      },
      {
        clave: "fecha",
        etiqueta: "Fecha de emisión",
        tipo: "fecha",
        requerido: true,
        alias: ["fecha", "fechaemision", "emision", "fechacomprobante"],
      },
      {
        clave: "codigoCliente",
        etiqueta: "Código del cliente",
        tipo: "texto",
        alias: ["codigocliente", "codcliente", "nrocliente", "idcliente", "codigo"],
      },
      {
        clave: "clienteNombre",
        etiqueta: "Nombre del cliente",
        tipo: "texto",
        alias: ["nombrecliente", "razonsocial", "cliente", "nombre"],
      },
      {
        clave: "clienteCuit",
        etiqueta: "CUIT del cliente",
        tipo: "cuit",
        alias: ["cuit", "cuil", "cuitcliente", "documento"],
      },
      {
        clave: "neto",
        etiqueta: "Neto gravado",
        tipo: "numero",
        alias: ["neto", "netogravado", "gravado", "subtotal", "importeneto"],
      },
      {
        clave: "iva",
        etiqueta: "IVA",
        tipo: "numero",
        alias: ["iva", "importeiva", "ivainscripto", "impuesto"],
      },
      {
        clave: "total",
        etiqueta: "Total",
        tipo: "numero",
        requerido: true,
        alias: ["total", "importetotal", "importe", "monto"],
      },
      {
        clave: "cae",
        etiqueta: "CAE",
        tipo: "texto",
        alias: ["cae", "caea", "codigoautorizacion", "autorizacion"],
      },
      {
        clave: "caeVence",
        etiqueta: "Vencimiento del CAE",
        tipo: "fecha",
        alias: ["caevence", "vencimientocae", "fechavencimientocae", "vtocae"],
      },
    ],
  },
];

export function definicionDe(clave: ClaveEntidad): DefinicionEntidad {
  const entidad = ENTIDADES.find((e) => e.clave === clave);
  if (!entidad) throw new Error(`Entidad de migración desconocida: ${clave}`);
  return entidad;
}

/* -------------------------------------------------------------------------- */
/* Mapeo de columnas                                                           */
/* -------------------------------------------------------------------------- */

/** Índice de columna por cada campo de destino. -1 es "sin mapear". */
export type Mapeo = Record<string, number>;

/**
 * Propone un mapeo mirando los nombres de las columnas.
 *
 * Una columna se usa una sola vez: varios campos comparten alias —"categoria"
 * puede ser el rubro de un producto o el segmento de un cliente— y el orden en
 * que están declarados los campos define quién se la queda. Es una propuesta,
 * no una decisión: todo se puede corregir en la pantalla.
 */
export function automapear(
  entidad: DefinicionEntidad,
  columnas: string[],
): Mapeo {
  const normalizadas = columnas.map(normalizarEncabezado);
  const tomadas = new Set<number>();
  const mapeo: Mapeo = {};

  for (const campo of entidad.campos) mapeo[campo.clave] = -1;

  // Primero las coincidencias exactas de todos los campos: así una columna
  // "Precio" no se la queda un campo que apenas la contiene.
  for (const campo of entidad.campos) {
    if (mapeo[campo.clave] !== -1) continue;

    const indice = normalizadas.findIndex(
      (columna, i) => !tomadas.has(i) && columna !== "" && campo.alias.includes(columna),
    );

    if (indice !== -1) {
      mapeo[campo.clave] = indice;
      tomadas.add(indice);
    }
  }

  // Después las parciales, y gana el sinónimo más largo: "Precio Profesional"
  // tiene que ir al campo del precio profesional y no al de lista, aunque
  // "precio" también aparezca adentro.
  for (const campo of entidad.campos) {
    if (mapeo[campo.clave] !== -1) continue;

    let mejor: { indice: number; largo: number } | null = null;

    normalizadas.forEach((columna, i) => {
      if (tomadas.has(i) || columna === "") return;
      for (const alias of campo.alias) {
        if (alias.length < 4 || !columna.includes(alias)) continue;
        if (!mejor || alias.length > mejor.largo) mejor = { indice: i, largo: alias.length };
      }
    });

    if (mejor) {
      const elegida = mejor as { indice: number; largo: number };
      mapeo[campo.clave] = elegida.indice;
      tomadas.add(elegida.indice);
    }
  }

  return mapeo;
}

/* -------------------------------------------------------------------------- */
/* Validación fila por fila                                                    */
/* -------------------------------------------------------------------------- */

export interface FilaNormalizada {
  /** Número de renglón en el archivo, contando el encabezado. */
  linea: number;
  datos: Record<string, string>;
  errores: string[];
  avisos: string[];
}

function interpretarOpcion(bruto: string, opciones: OpcionCampo[]): string | null {
  const clave = normalizarEncabezado(bruto);
  if (clave === "") return null;

  const exacta = opciones.find(
    (o) => o.alias.includes(clave) || normalizarEncabezado(o.valor) === clave,
  );
  if (exacta) return exacta.valor;

  // Coincidencia parcial, y gana el sinónimo más largo que aparezca adentro
  // del valor. Sin esa regla "metros cuadrados" se lo lleva "metro" —que está
  // primero en la lista— y el producto queda vendiéndose por metro lineal.
  let mejor: { valor: string; largo: number } | null = null;

  for (const opcion of opciones) {
    for (const alias of opcion.alias) {
      // Los sinónimos de dos o tres letras solo valen exactos: "ri" o "cf"
      // aparecen adentro de demasiadas palabras.
      if (alias.length < 4 || !clave.includes(alias)) continue;
      if (!mejor || alias.length > mejor.largo) {
        mejor = { valor: opcion.valor, largo: alias.length };
      }
    }
  }

  return mejor?.valor ?? null;
}

function interpretarEntero(bruto: string): string | null {
  const numero = interpretarNumero(bruto);
  if (numero === null) return null;
  return String(Math.round(Number(numero)));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Una fecha del sistema viejo a ISO.
 *
 * Los sistemas de escritorio argentinos escriben **día primero**: 03/09/2026
 * es el 3 de septiembre, no el 9 de marzo. `new Date(texto)` lo lee al revés
 * —asume formato de Estados Unidos— y el error es silencioso: la fecha entra,
 * es válida, y está corrida siete meses. En un archivo histórico de veinte mil
 * ventas eso no se descubre nunca.
 *
 * Se aceptan `d/m/aaaa`, `d-m-aaaa` y el ISO `aaaa-mm-dd` que ya viene bien.
 * Devuelve `null` si no entiende, para que la fila se rechace con motivo en
 * vez de entrar con una fecha inventada.
 */
export function interpretarFecha(texto: string): string | null {
  const limpio = texto.trim().split(/[\sT]/)[0];
  if (limpio === "") return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(limpio);
  const criollo = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(limpio);

  let anio: number, mes: number, dia: number;
  if (iso) {
    [anio, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (criollo) {
    dia = Number(criollo[1]);
    mes = Number(criollo[2]);
    anio = Number(criollo[3]);
    // Dos dígitos: 98 es 1998 y 26 es 2026. El corte en 70 es la convención
    // habitual y acá alcanza: la maderera abrió en 1981.
    if (anio < 100) anio += anio < 70 ? 2000 : 1900;
  } else {
    return null;
  }

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  // Rebota el 31 de febrero, que `Date` acomodaría al 3 de marzo sin avisar.
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;

  return fecha.toISOString();
}

/** Lee un campo y devuelve el valor normalizado o el motivo del rechazo. */
function leerCampo(
  campo: CampoDestino,
  bruto: string,
): { valor: string; error?: string; aviso?: string } {
  const texto = (bruto ?? "").trim();

  if (texto === "") {
    if (campo.requerido) {
      return { valor: "", error: `Falta ${campo.etiqueta.toLowerCase()}.` };
    }
    return { valor: campo.porDefecto ?? "" };
  }

  switch (campo.tipo) {
    case "numero": {
      const numero = interpretarNumero(texto);
      if (numero === null) {
        return {
          valor: campo.porDefecto ?? "",
          error: `${campo.etiqueta}: "${texto}" no es un número.`,
        };
      }
      return { valor: numero };
    }

    case "entero": {
      const entero = interpretarEntero(texto);
      if (entero === null) {
        return {
          valor: campo.porDefecto ?? "",
          error: `${campo.etiqueta}: "${texto}" no es un número.`,
        };
      }
      return { valor: entero };
    }

    case "cuit": {
      const digitos = soloDigitos(texto);
      if (digitos === "") return { valor: "" };
      // El CUIT mal formado no frena la fila: la ficha se migra igual y el
      // informe lo lista. Perder un cliente por un dígito es peor que
      // importarlo con el número a revisar; lo que no se puede es facturarle
      // así, y para eso está el aviso.
      if (!cuitValido(digitos)) {
        return {
          valor: digitos,
          aviso: `El CUIT ${texto} no verifica. Se migra igual, pero hay que corregirlo antes de facturar.`,
        };
      }
      return { valor: digitos };
    }

    case "email": {
      const correo = texto.toLowerCase();
      if (!EMAIL.test(correo)) {
        return { valor: "", aviso: `El correo "${texto}" no parece válido. Se deja vacío.` };
      }
      return { valor: correo };
    }

    case "fecha": {
      const fecha = interpretarFecha(texto);
      if (fecha === null) {
        return {
          valor: "",
          error: `${campo.etiqueta}: "${texto}" no es una fecha. Se espera día/mes/año.`,
        };
      }
      return { valor: fecha };
    }

    case "opcion": {
      const valor = interpretarOpcion(texto, campo.opciones ?? []);
      if (valor === null) {
        return {
          valor: campo.porDefecto ?? "",
          aviso: `${campo.etiqueta}: no se reconoció "${texto}"${
            campo.porDefecto ? `, queda en ${campo.porDefecto.replace(/_/g, " ")}` : ""
          }.`,
        };
      }
      return { valor };
    }

    default:
      return { valor: texto };
  }
}

/** Reglas que miran la fila entera, no un campo suelto. */
function validarFila(
  entidad: DefinicionEntidad,
  datos: Record<string, string>,
): { errores: string[]; avisos: string[] } {
  const errores: string[] = [];
  const avisos: string[] = [];

  if (entidad.clave === "saldos") {
    if (!datos.codigo && !datos.cuit && !datos.email) {
      errores.push(
        "No hay con qué encontrar al cliente: hace falta el código, el CUIT o el correo.",
      );
    }
  }

  if (entidad.clave === "clientes") {
    if (!datos.codigo && !datos.cuit) {
      avisos.push(
        "Sin código ni CUIT, la ficha se busca por nombre exacto. Dos clientes con el mismo nombre se pisan.",
      );
    }
    if (Number(datos.limiteCredito ?? "0") < 0) {
      errores.push("El límite de cuenta corriente no puede ser negativo.");
    }
  }

  if (entidad.clave === "stock" && Number(datos.cantidad ?? "0") < 0) {
    errores.push("La existencia no puede ser negativa.");
  }

  return { errores, avisos };
}

/**
 * Convierte las filas crudas del archivo en registros listos para escribir.
 *
 * No toca la base: dice qué dice el archivo y qué está mal en él. Lo que
 * depende de lo que ya existe —si el cliente está, si el SKU está— lo resuelve
 * `previsualizar` contra la base.
 */
export function normalizarFilas(
  entidad: DefinicionEntidad,
  mapeo: Mapeo,
  filas: string[][],
): FilaNormalizada[] {
  return filas.map((fila, i) => {
    const datos: Record<string, string> = {};
    const errores: string[] = [];
    const avisos: string[] = [];

    for (const campo of entidad.campos) {
      const indice = mapeo[campo.clave] ?? -1;
      const bruto = indice >= 0 ? (fila[indice] ?? "") : "";
      const leido = leerCampo(campo, bruto);

      datos[campo.clave] = leido.valor;
      if (leido.error) errores.push(leido.error);
      if (leido.aviso) avisos.push(leido.aviso);
    }

    const revision = validarFila(entidad, datos);

    return {
      // +2: el encabezado ocupa la línea 1 y el archivo cuenta desde 1.
      linea: i + 2,
      datos,
      errores: [...errores, ...revision.errores],
      avisos: [...avisos, ...revision.avisos],
    };
  });
}

/** Campos que hay que mapear sí o sí para poder seguir. */
export function faltantes(entidad: DefinicionEntidad, mapeo: Mapeo): string[] {
  return entidad.campos
    .filter((campo) => campo.requerido && (mapeo[campo.clave] ?? -1) < 0)
    .map((campo) => campo.etiqueta);
}
