// Package migracion trae los datos del sistema anterior (ISIS ERP Manager):
// clientes, productos, stock, saldos, proveedores y el archivo histórico de
// ventas y comprobantes. Era lib/migracion/{entidades,ejecutar}.ts,
// lib/dal/admin/migracion.ts y app/admin/migracion/actions.ts.
//
// Dos decisiones gobiernan el módulo, y se respetan tal cual:
//
//   - **Se escribe por lotes**, cada uno en su transacción (la pantalla los
//     manda de a Lote filas): un corte deja la mitad adentro, y la segunda
//     decisión lo vuelve inofensivo.
//   - **Todo es repetible**: cada entidad se reconoce por una clave natural
//     (el código del sistema viejo, el SKU, la sucursal, el número de
//     comprobante) y volver a subir el mismo archivo actualiza en vez de
//     duplicar.
//
// El módulo no conoce el archivo de ISIS: declara qué necesita cada tabla de
// destino y la pantalla dice qué columna es cada cosa (Automapear propone el
// mapeo con los alias).
package migracion

// Las opciones compartidas: cómo escribe el sistema viejo cada valor.
var condicionesIva = []Opcion{
	{Valor: "responsable_inscripto", Etiqueta: "Responsable inscripto", Alias: []string{"responsableinscripto", "respinscripto", "respinsc", "ri", "inscripto", "responsable", "1"}},
	{Valor: "monotributista", Etiqueta: "Monotributista", Alias: []string{"monotributista", "monotributo", "respmonotributo", "mt", "responsablemonotributo"}},
	{Valor: "exento", Etiqueta: "Exento", Alias: []string{"exento", "ex", "e"}},
	{Valor: "consumidor_final", Etiqueta: "Consumidor final", Alias: []string{"consumidorfinal", "cf", "final", "consumidor", "5"}},
	{Valor: "no_categorizado", Etiqueta: "No categorizado", Alias: []string{"nocategorizado", "sincategoria", "nc", "sinclasificar"}},
}

var tiposCliente = []Opcion{
	{Valor: "particular", Etiqueta: "Particular", Alias: []string{"particular", "consumidor", "minorista", "publico", "comun"}},
	{Valor: "profesional", Etiqueta: "Profesional", Alias: []string{"profesional", "mayorista", "gremio", "constructor", "carpintero", "arquitecto", "empresa"}},
}

var unidades = []Opcion{
	{Valor: "unidad", Etiqueta: "Unidad", Alias: []string{"unidad", "u", "un", "cu", "cadauno", "pieza", "pza"}},
	{Valor: "metro_lineal", Etiqueta: "Metro lineal", Alias: []string{"metrolineal", "ml", "metro", "metros", "m", "mlineal", "lineal", "lineales"}},
	{Valor: "metro_cuadrado", Etiqueta: "Metro cuadrado", Alias: []string{"metrocuadrado", "m2", "mtscuadrados", "metros2", "cuadrado", "cuadrados"}},
	{Valor: "tabla", Etiqueta: "Tabla", Alias: []string{"tabla", "tablas", "tb"}},
	{Valor: "placa", Etiqueta: "Placa", Alias: []string{"placa", "pl", "tablero", "chapa"}},
	{Valor: "rollo", Etiqueta: "Rollo", Alias: []string{"rollo", "ro"}},
	{Valor: "par", Etiqueta: "Par", Alias: []string{"par", "pares"}},
	{Valor: "juego", Etiqueta: "Juego", Alias: []string{"juego", "jgo", "set", "kit"}},
	{Valor: "kg", Etiqueta: "Kilogramo", Alias: []string{"kg", "kilo", "kilos", "kilogramo"}},
	{Valor: "litro", Etiqueta: "Litro", Alias: []string{"litro", "litros", "lt", "l"}},
}

// Entidades son las siete cosas que se pueden migrar, con sus campos.
// Generado de ENTIDADES (lib/migracion/entidades.ts, 56ef2a1); el golden
// (definiciones.json) compara que sean las mismas.
var Entidades = []Entidad{
	{
		Clave:     "clientes",
		Titulo:    "Clientes",
		Resumen:   "La cartera del mostrador: nombre, CUIT, contacto y condición frente al IVA.",
		Escribe:   "Crea o actualiza fichas en Clientes. No toca cuentas corrientes.",
		Identidad: "El código del sistema anterior. Si falta, el CUIT. Si tampoco hay, el nombre exacto.",
		Campos: []Campo{
			{Clave: "codigo", Etiqueta: "Código en el sistema anterior", Tipo: "texto", Ayuda: "Es lo que permite volver a subir el archivo sin duplicar nada, y lo que después ata los saldos a cada ficha.", Alias: []string{"codigo", "cod", "codcliente", "codigocliente", "nrocliente", "numerocliente", "idcliente", "id", "nro"}},
			{Clave: "nombre", Etiqueta: "Nombre", Tipo: "texto", Requerido: true, Alias: []string{"nombre", "cliente", "nombrecliente", "apellidoynombre", "denominacion", "razonsocial", "nombrefantasia"}},
			{Clave: "razonSocial", Etiqueta: "Razón social", Tipo: "texto", Alias: []string{"razonsocial", "razon", "denominacionfiscal"}},
			{Clave: "cuit", Etiqueta: "CUIT", Tipo: "cuit", Alias: []string{"cuit", "cuil", "cuitcuil", "documento", "nrodocumento", "dni"}},
			{Clave: "condicionIva", Etiqueta: "Condición frente al IVA", Tipo: "opcion", Opciones: condicionesIva, PorDefecto: p("consumidor_final"), Alias: []string{"condicioniva", "condiva", "iva", "condicion", "condicionfiscal", "situacioniva", "sitiva", "categoriaiva", "categfiscal", "tipoiva"}},
			{Clave: "email", Etiqueta: "Correo", Tipo: "email", Alias: []string{"email", "mail", "correo", "correoelectronico", "emailcliente"}},
			{Clave: "telefono", Etiqueta: "Teléfono", Tipo: "texto", Alias: []string{"telefono", "tel", "celular", "movil", "contacto", "telefonos"}},
			{Clave: "direccion", Etiqueta: "Domicilio", Tipo: "texto", Alias: []string{"direccion", "domicilio", "calle", "domiciliofiscal", "direccionfiscal"}},
			{Clave: "tipo", Etiqueta: "Tipo de cliente", Tipo: "opcion", Opciones: tiposCliente, PorDefecto: p("particular"), Alias: []string{"tipo", "tipocliente", "clase", "categoria", "segmento"}},
			{Clave: "limiteCredito", Etiqueta: "Límite de cuenta corriente", Tipo: "numero", PorDefecto: p("0"), Alias: []string{"limitecredito", "limite", "creditomaximo", "topecuentacorriente", "limitecuentacorriente"}},
			{Clave: "asesor", Etiqueta: "Vendedor asignado", Tipo: "texto", Alias: []string{"asesor", "vendedor", "responsable", "vendedorasignado"}},
			{Clave: "notas", Etiqueta: "Observaciones", Tipo: "texto", Alias: []string{"notas", "observaciones", "comentarios", "obs"}},
		},
	},
	{
		Clave:     "productos",
		Titulo:    "Productos y medidas",
		Resumen:   "El catálogo: un renglón por código. Los renglones con el mismo nombre y categoría quedan como medidas de un mismo producto.",
		Escribe:   "Crea o actualiza productos, medidas y —si vienen las columnas— los precios de lista general y profesional.",
		Identidad: "El código de cada medida.",
		Campos: []Campo{
			{Clave: "sku", Etiqueta: "Código del sistema anterior", Tipo: "texto", Requerido: true, Alias: []string{"sku", "codigo", "cod", "codigoarticulo", "codarticulo", "codproducto", "articulo", "idarticulo"}},
			{Clave: "nombre", Etiqueta: "Nombre del producto", Tipo: "texto", Requerido: true, Ayuda: "Sin la medida. Dos renglones con el mismo nombre y la misma categoría se agrupan en un producto con dos medidas.", Alias: []string{"nombre", "descripcion", "producto", "detalle", "denominacion", "descripcionarticulo"}},
			{Clave: "categoria", Etiqueta: "Categoría", Tipo: "texto", Requerido: true, Ayuda: "Si la categoría no existe en el catálogo, se crea.", Alias: []string{"categoria", "rubro", "familia", "grupo", "linea", "seccion"}},
			{Clave: "medida", Etiqueta: "Medida", Tipo: "texto", Ayuda: "Lo que ve el cliente: 2\" x 4\" x 3.60m. Si no viene, se usa el código.", Alias: []string{"medida", "medidas", "variante", "presentacion", "dimension", "dimensiones", "tamano"}},
			{Clave: "unidad", Etiqueta: "Unidad de venta", Tipo: "opcion", Opciones: unidades, PorDefecto: p("unidad"), Alias: []string{"unidad", "unidadmedida", "um", "unidadventa", "unidaddeventa"}},
			{Clave: "marca", Etiqueta: "Marca", Tipo: "texto", Alias: []string{"marca", "fabricante", "proveedor"}},
			{Clave: "descripcion", Etiqueta: "Descripción larga", Tipo: "texto", Alias: []string{"descripcionlarga", "detallelargo", "observaciones", "comentario"}},
			{Clave: "precioGeneral", Etiqueta: "Precio de lista", Tipo: "numero", Alias: []string{"precio", "preciolista", "preciogeneral", "preciopublico", "pvp", "preciounitario", "preciodeventa"}},
			{Clave: "precioProfesional", Etiqueta: "Precio profesional", Tipo: "numero", Alias: []string{"precioprofesional", "precioprof", "preciomayorista", "preciogremio", "precioespecial", "precio2"}},
			{Clave: "alicuotaIva", Etiqueta: "Alícuota de IVA", Tipo: "numero", PorDefecto: p("21"), Alias: []string{"alicuota", "alicuotaiva", "iva", "porcentajeiva"}},
			{Clave: "largoMm", Etiqueta: "Largo (mm)", Tipo: "entero", Ayuda: "Sale en la ficha técnica del producto, en Medidas disponibles.", Alias: []string{"largo", "largomm", "longitud"}},
			{Clave: "anchoMm", Etiqueta: "Ancho (mm)", Tipo: "entero", Alias: []string{"ancho", "anchomm"}},
			{Clave: "espesorMm", Etiqueta: "Espesor (mm)", Tipo: "entero", Alias: []string{"espesor", "espesormm", "alto", "altura"}},
		},
	},
	{
		Clave:     "stock",
		Titulo:    "Stock",
		Resumen:   "Las cantidades por sucursal con las que arranca el sistema nuevo. En el sistema anterior este listado se llama «existencias». Se sube después de los productos.",
		Escribe:   "Ajusta el stock físico de cada medida y deja el movimiento en el libro, con el motivo.",
		Identidad: "Código de medida y sucursal. Volver a subirlo deja el stock en el número del archivo, no lo suma.",
		Campos: []Campo{
			{Clave: "sku", Etiqueta: "Código del sistema anterior", Tipo: "texto", Requerido: true, Alias: []string{"sku", "codigo", "cod", "codigoarticulo", "codarticulo", "articulo", "idarticulo"}},
			{Clave: "sucursal", Etiqueta: "Sucursal", Tipo: "texto", Requerido: true, Ayuda: "Se busca por nombre. Tiene que existir en Sucursales.", Alias: []string{"sucursal", "deposito", "almacen", "local", "planta", "branch"}},
			{Clave: "cantidad", Etiqueta: "Existencia", Tipo: "entero", Requerido: true, Alias: []string{"cantidad", "stock", "existencia", "existencias", "qty", "saldo", "disponible"}},
			{Clave: "minimo", Etiqueta: "Mínimo de reposición", Tipo: "entero", Alias: []string{"minimo", "stockminimo", "puntoreposicion", "min", "reposicion"}},
		},
	},
	{
		Clave:     "saldos",
		Titulo:    "Saldos de cuenta corriente",
		Resumen:   "Lo que cada cliente debe al día del corte. Se corre después de los clientes y una sola vez.",
		Escribe:   "Carga un movimiento de ajuste por cliente, con el detalle «Saldo inicial migrado».",
		Identidad: "El movimiento de saldo inicial de cada cliente. Si ya lo tiene, la fila se omite en vez de sumar de nuevo.",
		Campos: []Campo{
			{Clave: "codigo", Etiqueta: "Código del cliente", Tipo: "texto", Ayuda: "El mismo con el que se migraron los clientes. Es la forma más segura de encontrarlos.", Alias: []string{"codigo", "cod", "codcliente", "codigocliente", "nrocliente", "idcliente", "id"}},
			{Clave: "cuit", Etiqueta: "CUIT", Tipo: "cuit", Alias: []string{"cuit", "cuil", "cuitcuil", "documento"}},
			{Clave: "email", Etiqueta: "Correo", Tipo: "email", Alias: []string{"email", "mail", "correo", "correoelectronico"}},
			{Clave: "nombre", Etiqueta: "Nombre del cliente", Tipo: "texto", Ayuda: "Solo para poder leer el informe. No se usa para buscar la ficha.", Alias: []string{"nombre", "cliente", "razonsocial", "apellidoynombre"}},
			{Clave: "saldo", Etiqueta: "Saldo", Tipo: "numero", Requerido: true, Ayuda: "Positivo es lo que el cliente debe. Negativo —o entre paréntesis— es saldo a favor.", Alias: []string{"saldo", "saldoactual", "deuda", "importe", "saldocuentacorriente", "total"}},
			{Clave: "detalle", Etiqueta: "Detalle", Tipo: "texto", Alias: []string{"detalle", "observaciones", "concepto", "comentario"}},
		},
	},
	{
		Clave:     "proveedores",
		Titulo:    "Proveedores",
		Resumen:   "La cartera de proveedores con sus datos fiscales. Se puede correr en cualquier momento; no depende de nada.",
		Escribe:   "Crea o actualiza la ficha del proveedor y, si viene saldo, deja un movimiento de saldo inicial en su cuenta corriente.",
		Identidad: "El código del sistema anterior, o el CUIT si no hay código. Volver a correr el archivo actualiza la ficha en vez de duplicarla.",
		Campos: []Campo{
			{Clave: "codigo", Etiqueta: "Código del proveedor", Tipo: "texto", Ayuda: "El del sistema viejo. Es lo que permite volver a subir el archivo sin duplicar la cartera.", Alias: []string{"codigo", "cod", "codproveedor", "codigoproveedor", "nroproveedor", "idproveedor", "id"}},
			{Clave: "nombre", Etiqueta: "Nombre", Tipo: "texto", Requerido: true, Alias: []string{"nombre", "proveedor", "razonsocial", "nombreproveedor", "descripcion"}},
			{Clave: "cuit", Etiqueta: "CUIT", Tipo: "cuit", Alias: []string{"cuit", "cuil", "cuitcuil", "documento"}},
			{Clave: "condicionIva", Etiqueta: "Condición frente al IVA", Tipo: "opcion", Opciones: condicionesIva, PorDefecto: p("responsable_inscripto"), Alias: []string{"condicioniva", "condicion", "iva", "situacioniva", "tipoiva", "categoria"}},
			{Clave: "email", Etiqueta: "Correo", Tipo: "email", Alias: []string{"email", "mail", "correo", "correoelectronico"}},
			{Clave: "telefono", Etiqueta: "Teléfono", Tipo: "texto", Alias: []string{"telefono", "tel", "celular", "movil", "contacto"}},
			{Clave: "direccion", Etiqueta: "Domicilio", Tipo: "texto", Alias: []string{"direccion", "domicilio", "calle", "domiciliofiscal"}},
			{Clave: "saldo", Etiqueta: "Saldo", Tipo: "numero", Ayuda: "Positivo es lo que le debemos al proveedor. Si viene vacío no se carga ningún movimiento.", Alias: []string{"saldo", "saldoactual", "deuda", "saldocuentacorriente"}},
			{Clave: "notas", Etiqueta: "Observaciones", Tipo: "texto", Alias: []string{"notas", "observaciones", "comentario", "detalle"}},
		},
	},
	{
		Clave:     "ventas_historicas",
		Titulo:    "Histórico de ventas",
		Resumen:   "Las ventas del sistema anterior, para poder consultarlas. Se corre después de los clientes.",
		Escribe:   "Escribe en el archivo histórico, que es de solo lectura. No crea pedidos: no mueve stock ni entra en ninguna cola de trabajo.",
		Identidad: "El número de comprobante del sistema viejo. Volver a correr el archivo actualiza la fila en vez de duplicarla.",
		Campos: []Campo{
			{Clave: "comprobante", Etiqueta: "Número de comprobante", Tipo: "texto", Requerido: true, Ayuda: "Cómo lo identificaba el sistema viejo. Es lo que evita cargar la misma venta dos veces.", Alias: []string{"comprobante", "numero", "nrocomprobante", "numerocomprobante", "factura", "nrofactura", "documento", "nro"}},
			{Clave: "fecha", Etiqueta: "Fecha", Tipo: "fecha", Requerido: true, Ayuda: "Día/mes/año, como lo escribe el sistema viejo.", Alias: []string{"fecha", "fechacomprobante", "fechaventa", "fechaemision", "emision"}},
			{Clave: "codigoCliente", Etiqueta: "Código del cliente", Tipo: "texto", Ayuda: "El mismo con el que se migraron los clientes. Sin esto la venta queda sin ficha asociada.", Alias: []string{"codigocliente", "codcliente", "cliente", "nrocliente", "idcliente", "codigo"}},
			{Clave: "clienteNombre", Etiqueta: "Nombre del cliente", Tipo: "texto", Alias: []string{"nombrecliente", "razonsocial", "cliente", "nombre", "apellidoynombre"}},
			{Clave: "total", Etiqueta: "Total", Tipo: "numero", Requerido: true, Alias: []string{"total", "importe", "importetotal", "monto", "totalventa"}},
			{Clave: "detalle", Etiqueta: "Detalle", Tipo: "texto", Ayuda: "Se guarda tal como viene, sin partirlo en renglones.", Alias: []string{"detalle", "descripcion", "concepto", "articulos", "observaciones"}},
			{Clave: "sucursal", Etiqueta: "Sucursal", Tipo: "texto", Alias: []string{"sucursal", "deposito", "local", "punto", "puntoventa"}},
			{Clave: "vendedor", Etiqueta: "Vendedor", Tipo: "texto", Alias: []string{"vendedor", "asesor", "usuario", "operador"}},
		},
	},
	{
		Clave:     "comprobantes_historicos",
		Titulo:    "Comprobantes emitidos",
		Resumen:   "Las facturas y notas que ya emitió el sistema anterior. Se corre después de los clientes.",
		Escribe:   "Escribe en el archivo histórico. **No toca la numeración fiscal nueva**: los comprobantes que emita esta plataforma siguen su propia serie.",
		Identidad: "Punto de venta, tipo y número. Volver a correr el archivo actualiza la fila en vez de duplicarla.",
		Campos: []Campo{
			{Clave: "puntoVenta", Etiqueta: "Punto de venta", Tipo: "entero", Requerido: true, Alias: []string{"puntoventa", "ptovta", "pv", "punto", "sucursal", "boca"}},
			{Clave: "tipo", Etiqueta: "Tipo de comprobante", Tipo: "texto", Requerido: true, Ayuda: "Se guarda tal como lo escribe el sistema viejo (\"Factura A\", \"FA\", \"NC B\"). No se reinterpreta: es un dato fiscal ya registrado en ARCA.", Alias: []string{"tipo", "tipocomprobante", "comprobante", "letra", "clase"}},
			{Clave: "numero", Etiqueta: "Número", Tipo: "entero", Requerido: true, Alias: []string{"numero", "nro", "nrocomprobante", "numerocomprobante", "correlativo"}},
			{Clave: "fecha", Etiqueta: "Fecha de emisión", Tipo: "fecha", Requerido: true, Alias: []string{"fecha", "fechaemision", "emision", "fechacomprobante"}},
			{Clave: "codigoCliente", Etiqueta: "Código del cliente", Tipo: "texto", Alias: []string{"codigocliente", "codcliente", "nrocliente", "idcliente", "codigo"}},
			{Clave: "clienteNombre", Etiqueta: "Nombre del cliente", Tipo: "texto", Alias: []string{"nombrecliente", "razonsocial", "cliente", "nombre"}},
			{Clave: "clienteCuit", Etiqueta: "CUIT del cliente", Tipo: "cuit", Alias: []string{"cuit", "cuil", "cuitcliente", "documento"}},
			{Clave: "neto", Etiqueta: "Neto gravado", Tipo: "numero", Alias: []string{"neto", "netogravado", "gravado", "subtotal", "importeneto"}},
			{Clave: "iva", Etiqueta: "IVA", Tipo: "numero", Alias: []string{"iva", "importeiva", "ivainscripto", "impuesto"}},
			{Clave: "total", Etiqueta: "Total", Tipo: "numero", Requerido: true, Alias: []string{"total", "importetotal", "importe", "monto"}},
			{Clave: "cae", Etiqueta: "CAE", Tipo: "texto", Alias: []string{"cae", "caea", "codigoautorizacion", "autorizacion"}},
			{Clave: "caeVence", Etiqueta: "Vencimiento del CAE", Tipo: "fecha", Alias: []string{"caevence", "vencimientocae", "fechavencimientocae", "vtocae"}},
		},
	},
}

// p es un puntero a un texto fijo.
func p(s string) *string { return &s }
