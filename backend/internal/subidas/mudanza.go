package subidas

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Los archivos que tienen que vivir en la carpeta privada y se subieron
// cuando iban a /subidas/: los comprobantes de transferencia y los
// documentos técnicos. Tabla y columna de cada uno.
var aPrivado = []struct{ tabla, columna string }{
	{"payments", "comprobante_url"},
	{"technical_documents", "url"},
}

// Mudanza es cuántos pasaron a la carpeta privada y cuáles no se pudieron
// mover (el archivo ya no estaba, por ejemplo).
type Mudanza struct {
	Movidos int
	Fallas  []string
}

// MudarAPrivado pasa a la carpeta privada lo que todavía tiene una
// referencia a /subidas/ y le cambia la referencia en la base. Es repetible:
// lo que ya se movió no vuelve a aparecer, y si una corrida se cortó entre
// mover el archivo y guardar la referencia, la siguiente lo encuentra en la
// privada y termina.
func (d *Disco) MudarAPrivado(ctx context.Context, pool *pgxpool.Pool) (Mudanza, error) {
	var m Mudanza
	for _, t := range aPrivado {
		filas, err := pool.Query(ctx, fmt.Sprintf(`SELECT id::text, %s FROM %s WHERE %s LIKE '/subidas/%%'`, t.columna, t.tabla, t.columna))
		if err != nil {
			return m, err
		}
		type fila struct{ id, url string }
		var pendientes []fila
		for filas.Next() {
			var f fila
			if err := filas.Scan(&f.id, &f.url); err != nil {
				filas.Close()
				return m, err
			}
			pendientes = append(pendientes, f)
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return m, err
		}
		for _, f := range pendientes {
			ref, err := d.MoverAPrivado(f.url)
			if err != nil {
				m.Fallas = append(m.Fallas, t.tabla+" "+f.id+" ("+f.url+"): "+err.Error())
				continue
			}
			if _, err := pool.Exec(ctx, fmt.Sprintf(`UPDATE %s SET %s = $2 WHERE id = $1`, t.tabla, t.columna), f.id, ref); err != nil {
				return m, err
			}
			m.Movidos++
		}
	}
	return m, nil
}
