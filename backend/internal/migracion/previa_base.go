package migracion

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cuit"
)

// Previsualizar es la vista previa mirando la base, sin escribir nada: dice
// qué filas caen sobre una ficha que ya existe y qué le cambiarían, y avisa
// del vendedor que no se encuentra. La vista de «Entran 3» no decía que una
// de las tres le cambiaba el nombre y el domicilio a un cliente que ya estaba
// (mes simulado, M2S1-030), ni que el vendedor no se iba a asignar
// (M2S3-018).
func (s *Servicio) Previsualizar(ctx context.Context, e Entidad, m Mapeo, filas [][]string) (VistaPrevia, error) {
	if sin := Faltantes(e, m); len(sin) > 0 {
		return Previsualizar(e, m, filas), nil
	}
	normalizadas := NormalizarFilas(e, m, filas)
	if e.Clave != "clientes" && e.Clave != "proveedores" {
		return armarVista(e, normalizadas, nil), nil
	}
	sobre := map[int]Sobre{}
	// Una transacción de solo lectura: buscarCliente y porNombre piden una.
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		nombres := &porNombre{consulta: `SELECT id::text, nombre, '' FROM customers ORDER BY created_at, id`}
		tabla := "customers"
		if e.Clave == "proveedores" {
			nombres = &porNombre{consulta: `SELECT id::text, nombre, '' FROM suppliers ORDER BY created_at, id`}
			tabla = "suppliers"
		}
		vendedores := &porNombre{consulta: `SELECT id::text, nombre, '' FROM sellers WHERE activo ORDER BY created_at, id`}
		vistos := map[string]bool{}
		for i := range normalizadas {
			f := &normalizadas[i]
			if len(f.Errores) > 0 {
				continue
			}
			d := f.Datos
			if e.Clave == "clientes" && d["asesor"] != "" {
				v, err := vendedores.buscar(ctx, tx, d["asesor"], "")
				if err != nil {
					return err
				}
				if v == "" {
					f.Avisos = append(f.Avisos, fmt.Sprintf("El vendedor «%s» no está entre los vendedores: la ficha queda sin vendedor.", d["asesor"]))
				}
			}
			var id string
			var err error
			if e.Clave == "clientes" {
				id, err = buscarCliente(ctx, tx, d, nombres)
			} else {
				id, err = buscarProveedor(ctx, tx, d, nombres)
			}
			if err != nil {
				return err
			}
			// Dos filas del archivo sobre la misma ficha nueva no «actualizan».
			if id == "" || vistos[id] {
				continue
			}
			vistos[id] = true
			var nombre, direccion, cuitBase, email, telefono, condicion, tipo string
			tipoCol := "''"
			if e.Clave == "clientes" {
				tipoCol = "tipo::text"
			}
			if err := tx.QueryRow(ctx, `SELECT nombre, coalesce(direccion, ''), coalesce(cuit, ''), coalesce(email, ''),
				coalesce(telefono, ''), condicion_iva::text, `+tipoCol+` FROM `+tabla+` WHERE id = $1`, id).
				Scan(&nombre, &direccion, &cuitBase, &email, &telefono, &condicion, &tipo); err != nil {
				return err
			}
			// Lo mismo que escribe aplicarClientes: lo que el archivo no trae
			// no pisa lo que había, así que no es un cambio. El tipo que cae en
			// «particular» por defecto tampoco; el que viene escrito, o el que
			// sale del rubro, sí (mes 23: una ficha pasaba de profesional a
			// particular sin que la vista previa lo dijera).
			condicionNueva := d["condicionIva"]
			if f.Vacios["condicionIva"] {
				condicionNueva = ""
			}
			campos := [][3]string{
				{"Nombre", nombre, d["nombre"]},
				{"Domicilio", direccion, d["direccion"]},
				{"CUIT", cuit.FormatearLargo(cuitBase), cuit.FormatearLargo(d["cuit"])},
				{"Correo", email, d["email"]},
				{"Teléfono", telefono, d["telefono"]},
				{"Condición frente al IVA", strings.ReplaceAll(condicion, "_", " "), strings.ReplaceAll(condicionNueva, "_", " ")},
			}
			if e.Clave == "clientes" {
				tipoNuevo := d["tipo"]
				if f.Vacios["tipo"] && tipoNuevo == "particular" {
					tipoNuevo = ""
				}
				campos = append(campos, [3]string{"Tipo", etiquetaDeTipo(tipo), etiquetaDeTipo(tipoNuevo)})
			}
			sobre[f.Linea] = Sobre{Actualiza: true, Cambios: cambios(campos)}
		}
		return nil
	})
	if err != nil {
		return VistaPrevia{}, err
	}
	return armarVista(e, normalizadas, sobre), nil
}

// cambios son los campos que la fila cambia: «Domicilio: A → B». Un campo que
// el archivo trae vacío no se pisa (la escritura conserva lo que había), así
// que no es un cambio: decía «Teléfono → vacío» y el teléfono quedaba.
func cambios(campos [][3]string) []string {
	out := []string{}
	for _, c := range campos {
		antes, despues := strings.TrimSpace(c[1]), strings.TrimSpace(c[2])
		if despues == "" || comparable(antes) == comparable(despues) {
			continue
		}
		if antes == "" {
			antes = "vacío"
		}
		out = append(out, c[0]+": "+antes+" → "+despues)
	}
	return out
}

// buscarProveedor es la misma cascada que aplicarProveedores: código, CUIT y
// nombre.
func buscarProveedor(ctx context.Context, tx pgx.Tx, d map[string]string, nombres *porNombre) (string, error) {
	if d["codigo"] != "" {
		if id, err := unID(ctx, tx, `SELECT id FROM suppliers WHERE codigo_legacy = $1 LIMIT 1`, d["codigo"]); id != "" || err != nil {
			return id, err
		}
	}
	if d["cuit"] != "" {
		if id, err := unID(ctx, tx, `SELECT id FROM suppliers WHERE cuit = ANY($1) LIMIT 1`, cuit.Variantes(d["cuit"])); id != "" || err != nil {
			return id, err
		}
	}
	return nombres.buscar(ctx, tx, d["nombre"], "")
}

// etiquetaDeTipo es el tipo de cliente como lo dice la ficha.
func etiquetaDeTipo(tipo string) string {
	for _, o := range tiposCliente {
		if o.Valor == tipo {
			return o.Etiqueta
		}
	}
	return tipo
}
