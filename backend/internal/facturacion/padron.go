package facturacion

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/fiscal"
	"mjbj/internal/jsmath"
)

// El padrón de ARBA (fiscal.PercepcionIibb). Cargarlo CUIT por CUIT era
// rehacerlo a mano todos los meses: se importa el archivo mensual tal como
// lo baja ARBA (el .txt o el .zip) y se queda solo con los CUIT de nuestros
// clientes. El archivo entero son millones de renglones; los de los clientes,
// unos cientos.

// TopeDelPadron es lo más grande que se acepta: el .txt mensual de ARBA
// anda por los 200 MB.
const TopeDelPadron = 400 << 20

// ResultadoDelPadron es lo que quedó de una importación.
type ResultadoDelPadron struct {
	Leidos   int    `json:"leidos"`
	Cargados int    `json:"cargados"`
	Desde    string `json:"desde"`
	Hasta    string `json:"hasta"`
}

// FilaDelPadron es un CUIT del padrón con su cliente.
type FilaDelPadron struct {
	Cuit     string  `json:"cuit"`
	Cliente  *string `json:"cliente"`
	Alicuota float64 `json:"alicuota"`
	Desde    string  `json:"desde"`
	Hasta    string  `json:"hasta"`
}

// lineasDelArchivo da los renglones del padrón, sea el .txt o el .zip de
// ARBA (que puede traer el de percepción y el de retención juntos: los
// renglones dicen de cuál son).
func lineasDelArchivo(r io.Reader, cada func(string)) error {
	br := bufio.NewReaderSize(io.LimitReader(r, TopeDelPadron), 1<<20)
	cabeza, _ := br.Peek(2)
	if string(cabeza) != "PK" {
		return escanear(br, cada)
	}
	// El zip necesita leerse entero: el índice está al final.
	todo, err := io.ReadAll(br)
	if err != nil {
		return err
	}
	z, err := zip.NewReader(bytes.NewReader(todo), int64(len(todo)))
	if err != nil {
		return errEmision("El archivo no es el padrón de ARBA.")
	}
	for _, f := range z.File {
		if f.FileInfo().IsDir() || !strings.HasSuffix(strings.ToLower(f.Name), ".txt") {
			continue
		}
		a, err := f.Open()
		if err != nil {
			return err
		}
		err = escanear(a, cada)
		a.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func escanear(r io.Reader, cada func(string)) error {
	s := bufio.NewScanner(r)
	s.Buffer(make([]byte, 64<<10), 64<<10)
	for s.Scan() {
		cada(s.Text())
	}
	return s.Err()
}

// ImportarPadron lee el archivo de ARBA y reemplaza, para los CUIT de los
// clientes que figuran, lo que se pisa con su vigencia. Un archivo sin ningún
// renglón de percepción se rechaza (no es el padrón, o es el de retención).
func (s *Servicio) ImportarPadron(ctx context.Context, userID string, archivo io.Reader) (ResultadoDelPadron, error) {
	clientes := map[string]bool{}
	filas, err := s.pool.Query(ctx, `SELECT DISTINCT regexp_replace(cuit, '\D', '', 'g') FROM customers WHERE cuit IS NOT NULL`)
	if err != nil {
		return ResultadoDelPadron{}, err
	}
	for filas.Next() {
		var c string
		if err := filas.Scan(&c); err != nil {
			filas.Close()
			return ResultadoDelPadron{}, err
		}
		if len(c) == 11 {
			clientes[c] = true
		}
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return ResultadoDelPadron{}, err
	}
	var r ResultadoDelPadron
	nuestros := map[string]fiscal.LineaDelPadron{}
	if err := lineasDelArchivo(archivo, func(texto string) {
		l, ok := fiscal.LeerLineaDelPadron(texto)
		if !ok {
			return
		}
		r.Leidos++
		if r.Desde == "" || l.Desde < r.Desde {
			r.Desde = l.Desde
		}
		if l.Hasta > r.Hasta {
			r.Hasta = l.Hasta
		}
		if clientes[l.Cuit] {
			nuestros[l.Cuit] = l
		}
	}); err != nil {
		if Mensaje(err) != "" {
			return ResultadoDelPadron{}, err
		}
		s.log.Error("padrón de ARBA", "error", err)
		return ResultadoDelPadron{}, errEmision("No se pudo leer el archivo.")
	}
	if r.Leidos == 0 {
		return ResultadoDelPadron{}, errEmision("El archivo no tiene renglones de percepción: no es el padrón de ARBA.")
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Lo que se pisa con la vigencia nueva se reemplaza: con dos filas
		// vigentes el mismo día, la emisión elegiría una al azar.
		for c, l := range nuestros {
			if _, err := tx.Exec(ctx, `DELETE FROM padron_iibb WHERE cuit = $1 AND vigencia_desde <= $3::date AND vigencia_hasta >= $2::date`,
				c, l.Desde, l.Hasta); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO padron_iibb (cuit, alicuota, vigencia_desde, vigencia_hasta, cargado_por)
				VALUES ($1, $2::numeric, $3::date, $4::date, nullif($5, ''))`, c, jsmath.ToFixed(l.Alicuota, 3), l.Desde, l.Hasta, userID); err != nil {
				return err
			}
			r.Cargados++
		}
		return nil
	})
	return r, err
}

// Padron son las filas vigentes hoy o después, por CUIT.
func (s *Servicio) Padron(ctx context.Context) ([]FilaDelPadron, error) {
	hoy := s.ahora().In(fiscal.Argentina).Format("2006-01-02")
	filas, err := s.pool.Query(ctx, `SELECT p.cuit, (SELECT coalesce(nullif(c.razon_social, ''), c.nombre) FROM customers c
		WHERE regexp_replace(c.cuit, '\D', '', 'g') = p.cuit ORDER BY c.created_at LIMIT 1),
		p.alicuota::float8, to_char(p.vigencia_desde, 'YYYY-MM-DD'), to_char(p.vigencia_hasta, 'YYYY-MM-DD')
		FROM padron_iibb p WHERE p.vigencia_hasta >= $1::date ORDER BY p.vigencia_desde DESC, p.cuit`, hoy)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []FilaDelPadron{}
	for filas.Next() {
		var f FilaDelPadron
		if err := filas.Scan(&f.Cuit, &f.Cliente, &f.Alicuota, &f.Desde, &f.Hasta); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, filas.Err()
}

// filaDelPadron es la fila vigente ese día para ese CUIT, o nil.
func filaDelPadron(ctx context.Context, c consultor, documento string, dia string) (*fiscal.FilaPadron, error) {
	var f fiscal.FilaPadron
	err := c.QueryRow(ctx, `SELECT alicuota::float8, to_char(vigencia_desde, 'YYYY-MM-DD'), to_char(vigencia_hasta, 'YYYY-MM-DD')
		FROM padron_iibb WHERE cuit = $1 AND vigencia_desde <= $2::date AND vigencia_hasta >= $2::date
		ORDER BY vigencia_desde DESC LIMIT 1`, fiscal.SoloDigitos(documento), dia).Scan(&f.Alicuota, &f.Desde, &f.Hasta)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

// hayPadronVigente dice si el padrón tiene alguna fila vigente ese día.
func hayPadronVigente(ctx context.Context, c consultor, dia time.Time) (bool, error) {
	var hay bool
	err := c.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM padron_iibb WHERE vigencia_desde <= $1::date AND vigencia_hasta >= $1::date)`,
		dia.In(fiscal.Argentina).Format("2006-01-02")).Scan(&hay)
	return hay, err
}
