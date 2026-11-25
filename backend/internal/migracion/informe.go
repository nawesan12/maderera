package migracion

import (
	"math"
	"strconv"

	"mjbj/internal/jsmath"
)

// Control es un renglón del informe de integridad: lo que decía el archivo
// contra lo que quedó en la base.
type Control struct {
	Titulo         string `json:"titulo"`
	Detalle        string `json:"detalle"`
	SegunElArchivo string `json:"segunElArchivo"`
	EnElSistema    string `json:"enElSistema"`
	Ok             bool   `json:"ok"`
}

// EnLaBase es lo que contesta la base para el informe de cada entidad.
type EnLaBase struct {
	// Total es la suma de Postgres (numeric) como texto.
	Total      string  `json:"total"`
	Cuantos    int     `json:"cuantos"`
	Fichas     int     `json:"fichas"`
	TotalStock float64 `json:"totalStock"`
}

func validas(filas []Fila) []Fila {
	var out []Fila
	for _, f := range filas {
		if len(f.Errores) == 0 {
			out = append(out, f)
		}
	}
	return out
}

func sumar(filas []Fila, campo string) float64 {
	suma := 0.0
	for _, f := range filas {
		suma = float64(suma + numeroJS(f.Datos[campo]))
	}
	return suma
}

func contar(filas []Fila, cumple func(Fila) bool) int {
	n := 0
	for _, f := range filas {
		if cumple(f) {
			n++
		}
	}
	return n
}

func itoa(n int) string { return strconv.Itoa(n) }

// Controles arma el informe (la parte de informeDeIntegridad que no lee la
// base). En saldos, la diferencia entre el archivo y el sistema es plata de
// alguien: el total del archivo se cuenta entero, también lo que no
// encontró ficha.
func Controles(entidad string, filas []Fila, base EnLaBase) []Control {
	v := validas(filas)
	total := numeroJS(base.Total)

	switch entidad {
	case "saldos":
		esperado := sumar(v, "saldo")
		conSaldo := contar(v, func(f Fila) bool { return numeroJS(f.Datos["saldo"]) != 0 })
		return []Control{
			{
				Titulo:         "Suma de los saldos",
				Detalle:        "El archivo entero contra todo lo migrado hasta ahora. Si no da igual, hay filas que no entraron y la diferencia es deuda de alguien: está en el listado de abajo. Migrando en varias partes, el número del sistema va a ser mayor.",
				SegunElArchivo: jsmath.ToFixed(esperado, 2),
				EnElSistema:    jsmath.ToFixed(total, 2),
				Ok:             float64(total+0.01) >= esperado,
			},
			{
				Titulo:         "Clientes con saldo inicial",
				Detalle:        "Sin contar los que venían en cero, que no generan movimiento porque un movimiento en cero solo ensucia el resumen de cuenta.",
				SegunElArchivo: itoa(conSaldo),
				EnElSistema:    itoa(base.Cuantos),
				Ok:             base.Cuantos >= conSaldo,
			},
		}

	case "clientes":
		codigos := map[string]bool{}
		for _, f := range v {
			if c := f.Datos["codigo"]; c != "" {
				codigos[c] = true
			}
		}
		sinCuit := contar(v, func(f Fila) bool { return f.Datos["cuit"] == "" })
		return []Control{
			{
				Titulo:         "Fichas con código del sistema anterior",
				Detalle:        "Si el archivo trae códigos repetidos, este número va a ser menor: dos filas con el mismo código son la misma ficha.",
				SegunElArchivo: itoa(len(codigos)),
				EnElSistema:    itoa(base.Cuantos),
				Ok:             base.Cuantos >= len(codigos),
			},
			{
				Titulo:         "Fichas sin CUIT",
				Detalle:        "No es un error —media cartera son consumidores finales—, pero a esos no se les puede emitir factura A.",
				SegunElArchivo: itoa(sinCuit),
				EnElSistema:    "—",
				Ok:             true,
			},
		}

	case "proveedores":
		var conSaldo []Fila
		for _, f := range v {
			if numeroJS(f.Datos["saldo"]) != 0 {
				conSaldo = append(conSaldo, f)
			}
		}
		esperado := sumar(conSaldo, "saldo")
		conCodigo := contar(v, func(f Fila) bool { return f.Datos["codigo"] != "" })
		return []Control{
			{
				Titulo:         "Proveedores con código del sistema anterior",
				Detalle:        "Los que se pueden volver a actualizar subiendo el archivo de nuevo.",
				SegunElArchivo: itoa(conCodigo),
				EnElSistema:    itoa(base.Fichas),
				Ok:             base.Fichas >= conCodigo,
			},
			{
				Titulo:         "Suma de los saldos",
				Detalle:        "Tiene que dar igual. Una diferencia es un proveedor cuyo saldo no se cargó, y eso no lo muestra ningún contador de filas.",
				SegunElArchivo: jsmath.ToFixed(esperado, 2),
				EnElSistema:    jsmath.ToFixed(total, 2),
				Ok:             math.Abs(float64(esperado-total)) < 0.01,
			},
		}

	case "ventas_historicas":
		esperado := sumar(v, "total")
		sinFicha := contar(v, func(f Fila) bool { return f.Datos["codigoCliente"] == "" })
		return []Control{
			{
				Titulo:         "Ventas en el archivo histórico",
				Detalle:        "Puede ser mayor si ya se subieron otros años.",
				SegunElArchivo: itoa(len(v)),
				EnElSistema:    itoa(base.Cuantos),
				Ok:             base.Cuantos >= len(v),
			},
			{
				Titulo:         "Suma de los totales",
				Detalle:        "El del sistema incluye las veces anteriores; el del archivo, solo esta.",
				SegunElArchivo: jsmath.ToFixed(esperado, 2),
				EnElSistema:    jsmath.ToFixed(total, 2),
				Ok:             total >= float64(esperado-0.01),
			},
			{
				Titulo:         "Ventas sin código de cliente",
				Detalle:        "Quedan en el histórico pero no aparecen en la ficha de nadie. Se reconcilian a mano.",
				SegunElArchivo: itoa(sinFicha),
				EnElSistema:    "—",
				Ok:             sinFicha == 0,
			},
		}

	case "comprobantes_historicos":
		esperado := sumar(v, "total")
		sinCae := contar(v, func(f Fila) bool { return f.Datos["cae"] == "" })
		return []Control{
			{
				Titulo:         "Comprobantes en el archivo histórico",
				Detalle:        "Puede ser mayor si ya se subieron otros períodos.",
				SegunElArchivo: itoa(len(v)),
				EnElSistema:    itoa(base.Cuantos),
				Ok:             base.Cuantos >= len(v),
			},
			{
				Titulo:         "Suma de los totales",
				Detalle:        "Es la cifra que el estudio contable va a querer cruzar.",
				SegunElArchivo: jsmath.ToFixed(esperado, 2),
				EnElSistema:    jsmath.ToFixed(total, 2),
				Ok:             total >= float64(esperado-0.01),
			},
			{
				Titulo:         "Comprobantes sin CAE",
				Detalle:        "Se guardan igual, pero un comprobante autorizado que llegó sin CAE es una columna que faltó mapear.",
				SegunElArchivo: itoa(sinCae),
				EnElSistema:    "—",
				Ok:             sinCae == 0,
			},
		}

	case "productos":
		skus := map[string]bool{}
		for _, f := range v {
			skus[f.Datos["sku"]] = true
		}
		sinPrecio := contar(v, func(f Fila) bool { return numeroJS(f.Datos["precioGeneral"]) <= 0 })
		return []Control{
			{
				Titulo:         "Códigos distintos en el archivo",
				Detalle:        "Contra el total de medidas cargadas en el catálogo.",
				SegunElArchivo: itoa(len(skus)),
				EnElSistema:    itoa(base.Cuantos),
				Ok:             base.Cuantos >= len(skus),
			},
			{
				Titulo:         "Medidas sin precio de lista",
				Detalle:        "No se pueden vender por la tienda hasta que tengan precio.",
				SegunElArchivo: itoa(sinPrecio),
				EnElSistema:    "—",
				Ok:             sinPrecio == 0,
			},
		}
	}

	unidades := sumar(v, "cantidad")
	return []Control{{
		Titulo:         "Unidades en existencia",
		Detalle:        "El total del sistema puede ser mayor: incluye lo que ya estaba cargado en medidas que el archivo no menciona.",
		SegunElArchivo: jsmath.Texto(unidades),
		EnElSistema:    jsmath.Texto(base.TotalStock),
		Ok:             base.TotalStock >= unidades,
	}}
}
