// Package reglas son las reglas del negocio que decide el dueño (o el
// contador) y se cambian desde /admin/reglas. Cada una vive en una fila de
// site_settings y arranca con el comportamiento que el sistema tenía antes
// de existir la regla: cambiarla es una decisión, nunca un efecto de
// desplegar.
//
// Las de la migración 00104 y 00141 siguen leyéndose donde estaban
// (reportes, compras, precios.PorcentajeLibre); las de la 00290 —las
// políticas que esperan la respuesta del contador o de la clienta— se leen
// con Valor.
package reglas

import (
	"context"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Consultador es un pool o una transacción.
type Consultador interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Las claves de la 00290. El primer valor de cada una en Opciones es el de
// arranque.
const (
	// H162: cuándo una venta cuenta como vendida en reportes, inicio y cierre.
	VentaReconocida = "venta_reconocida"
	// H374: lo cobrado de un pedido antes de facturarlo.
	CobroAntesDeFacturar = "cobro_antes_de_facturar"
	// H407: lo que sobra de un cobro a cuenta corriente sin nada pendiente.
	ExcedenteCuentaCorriente = "excedente_cuenta_corriente"
	// H160: el cobro de una factura que todavía no tiene CAE, en los asientos.
	AsientoSinCAE = "asiento_sin_cae"
	// H019: el material de un corte por debajo de la media placa.
	CorteChicoMaterial = "corte_chico_material"
	// H037: cuándo la lista del cliente obliga a pagar de contado.
	ContadoPorLista = "contado_por_lista"
	// H168: si el descuento por medio de pago alcanza al flete.
	DescuentoAlFlete = "descuento_al_flete"
	// H207: el comprobante que el responsable inscripto le hace al monotributista.
	FacturaAlMonotributista = "factura_al_monotributista"
	// H086: si el profesional ve sus precios con la tienda apagada.
	PreciosProfesionalSinTienda = "precios_profesional_sin_tienda"
	// H045: si el corte suelto pregunta dónde se corta.
	SucursalDelCorteSuelto = "sucursal_del_corte_suelto"
	// H016: si la contraseña de un admin firma mientras nadie cargó un PIN.
	FirmaSinPIN = "firma_sin_pin"
	// H085: si el cliente acepta desde el portal un presupuesto todavía pendiente.
	AceptarPresupuestoPendiente = "aceptar_presupuesto_pendiente"
	// H167: cómo se nombra el circuito sin factura en las pantallas.
	EtiquetaDelCircuito = "etiqueta_del_circuito"
	// H079: qué datos fiscales cambia el cliente desde Mi cuenta.
	DatosFiscalesDelCliente = "datos_fiscales_del_cliente"
	// H032: si la tarjeta en línea pide lote y cupón.
	LoteYCupon = "lote_y_cupon"
	// M3S3-002: la deuda cargada a mano en la cuenta de un cliente (el saldo
	// del sistema anterior, una nota de débito sin comprobante): al circuito
	// B, como hasta ahora, o al archivo del estudio contra Saldos iniciales.
	DeudaSinComprobante = "deuda_sin_comprobante"
)

// Opciones son los valores posibles de cada regla, el de arranque primero.
var Opciones = map[string][]string{
	VentaReconocida:             {"entregar_o_facturar", "tomar", "entregar", "facturar"},
	CobroAntesDeFacturar:        {"circuito_b", "anticipos"},
	ExcedenteCuentaCorriente:    {"circuito_b", "anticipos"},
	AsientoSinCAE:               {"al_cae", "transitoria"},
	CorteChicoMaterial:          {"sin_cargo", "cobrar"},
	ContadoPorLista:             {"con_ventaja", "siempre"},
	DescuentoAlFlete:            {"no", "si"},
	FacturaAlMonotributista:     {"a", "b"},
	PreciosProfesionalSinTienda: {"no", "si"},
	SucursalDelCorteSuelto:      {"primera", "preguntar"},
	FirmaSinPIN:                 {"contrasena", "solo_pin"},
	AceptarPresupuestoPendiente: {"no", "si"},
	EtiquetaDelCircuito:         {"b", "sin_factura", "interno"},
	DatosFiscalesDelCliente:     {"hasta_facturar", "ninguno"},
	LoteYCupon:                  {"obligatorio", "opcional"},
	DeudaSinComprobante:         {"circuito_b", "saldo_inicial"},
}

// Arranque es el valor de una regla cuando la fila no está o tiene algo que
// no es una opción.
func Arranque(clave string) string {
	if o, ok := Opciones[clave]; ok {
		return o[0]
	}
	return ""
}

// Valida dice si valor es una opción de la regla.
func Valida(clave, valor string) bool {
	o, ok := Opciones[clave]
	return ok && slices.Contains(o, valor)
}

// Valor lee una regla. Sin fila (una base de pruebas sin datos) o con un
// valor que no es una opción, da el de arranque: una regla rota nunca hace
// que el sistema cambie de comportamiento sin que nadie lo haya elegido.
func Valor(ctx context.Context, c Consultador, clave string) (string, error) {
	var v string
	err := c.QueryRow(ctx, `SELECT valor FROM site_settings WHERE clave = $1`, clave).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return Arranque(clave), nil
	}
	if err != nil {
		return "", err
	}
	if !Valida(clave, v) {
		return Arranque(clave), nil
	}
	return v, nil
}

// Es dice si la regla vale valor. Un error de la base da el de arranque.
func Es(ctx context.Context, c Consultador, clave, valor string) bool {
	v, err := Valor(ctx, c, clave)
	if err != nil {
		v = Arranque(clave)
	}
	return v == valor
}

// Fijar cambia una regla en una prueba (inserta la fila si no está).
func Fijar(ctx context.Context, c Consultador, clave, valor string) error {
	_, err := c.Exec(ctx, `INSERT INTO site_settings (clave, valor) VALUES ($1, $2)
		ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor`, clave, valor)
	return err
}
