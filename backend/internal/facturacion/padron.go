package facturacion

import (
	"archive/zip"
	"bufio"
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/fiscal"
	"mjbj/internal/jsmath"
)

// El padrón de ARBA (fiscal.PercepcionIibb). Cargarlo CUIT por CUIT era
// rehacerlo a mano todos los meses: se importa el archivo mensual tal como
// lo baja ARBA (el .txt o el .zip) y se guarda **entero**. Antes se quedaba
// solo con los CUIT de los clientes del día de la importación, y el cliente
// que se daba de alta el día 5 (lo más común en un mostrador) quedaba «sin
// padrón» todo el mes, aunque figuraba en el archivo. Son unos millones de
// renglones: van por COPY a una tabla temporal y de ahí, de una, al padrón.
//
// La subida va directo a Go (/api/v1, con su propio tope en Caddy): pasando
// por Next, el proxy guardaba en memoria solo los primeros 10 MB y Go
// importaba un padrón cortado sin ningún error.

// TopeDelPadron es lo más grande que se acepta: el .txt mensual de ARBA
// anda por los 200 MB. Pasarse es un error, no un corte en silencio.
const TopeDelPadron = 400 << 20

// ResultadoDelPadron es lo que quedó de una importación.
type ResultadoDelPadron struct {
	Leidos int `json:"leidos"`
	// Cargados son los clientes con CUIT que figuran.
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

// conTope corta con un error al pasarse: io.LimitReader cortaba callado y
// lo leído hasta ahí se importaba como si fuera el padrón entero.
type conTope struct {
	r     io.Reader
	queda int64
}

func (c *conTope) Read(p []byte) (int, error) {
	if c.queda <= 0 {
		var b [1]byte
		if n, _ := c.r.Read(b[:]); n > 0 {
			return 0, errEmision("El archivo pasa de 400 MB: no es el padrón de ARBA.")
		}
		return 0, io.EOF
	}
	if int64(len(p)) > c.queda {
		p = p[:c.queda]
	}
	n, err := c.r.Read(p)
	c.queda -= int64(n)
	return n, err
}

// lineasDelArchivo da los renglones del padrón, sea el .txt o el .zip de
// ARBA (que puede traer el de percepción y el de retención juntos: los
// renglones dicen de cuál son). El .zip va a un archivo temporal: su índice
// está al final, y leerlo entero en memoria eran cientos de MB en la VPS,
// al lado de la API.
func lineasDelArchivo(r io.Reader, cada func(string) error) error {
	br := bufio.NewReaderSize(&conTope{r: r, queda: TopeDelPadron}, 1<<20)
	cabeza, _ := br.Peek(2)
	if string(cabeza) != "PK" {
		return escanear(br, cada)
	}
	tmp, err := os.CreateTemp("", "padron-*.zip")
	if err != nil {
		return err
	}
	defer func() {
		tmp.Close()
		os.Remove(tmp.Name())
	}()
	largo, err := io.Copy(tmp, br)
	if err != nil {
		return err
	}
	z, err := zip.NewReader(tmp, largo)
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
		err = escanear(&conTope{r: a, queda: 4 * TopeDelPadron}, cada)
		a.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func escanear(r io.Reader, cada func(string) error) error {
	s := bufio.NewScanner(r)
	s.Buffer(make([]byte, 64<<10), 64<<10)
	for s.Scan() {
		if err := cada(s.Text()); err != nil {
			return err
		}
	}
	return s.Err()
}

// ImportarPadron lee el archivo de ARBA y reemplaza lo que se pisa con su
// vigencia. Un archivo sin ningún renglón de percepción se rechaza (no es el
// padrón, o es el de retención). Un corte en la subida es un error de
// lectura (el cuerpo no llega a su largo, el .zip no tiene índice) y no
// se importa nada: va todo en una transacción.
func (s *Servicio) ImportarPadron(ctx context.Context, userID string, archivo io.Reader) (ResultadoDelPadron, error) {
	var r ResultadoDelPadron
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `CREATE TEMP TABLE padron_nuevo (cuit text, alicuota numeric(6, 3), desde date, hasta date) ON COMMIT DROP`); err != nil {
			return err
		}
		// El archivo se lee mientras se copia: nada de millones de filas en
		// memoria.
		lectura, cortar := context.WithCancel(ctx)
		defer cortar()
		filas := make(chan []any, 4096)
		errLectura := make(chan error, 1)
		go func() {
			defer close(filas)
			errLectura <- lineasDelArchivo(archivo, func(texto string) error {
				l, ok := fiscal.LeerLineaDelPadron(texto)
				if !ok {
					return nil
				}
				r.Leidos++
				if r.Desde == "" || l.Desde < r.Desde {
					r.Desde = l.Desde
				}
				if l.Hasta > r.Hasta {
					r.Hasta = l.Hasta
				}
				select {
				case filas <- []any{l.Cuit, jsmath.ToFixed(l.Alicuota, 3), l.Desde, l.Hasta}:
					return nil
				case <-lectura.Done():
					return lectura.Err()
				}
			})
		}()
		_, errCopia := tx.CopyFrom(ctx, pgx.Identifier{"padron_nuevo"}, []string{"cuit", "alicuota", "desde", "hasta"}, &desdeCanal{filas: filas})
		cortar()
		for range filas {
		}
		if err := <-errLectura; err != nil && !errors.Is(err, context.Canceled) {
			if Mensaje(err) != "" {
				return err
			}
			s.log.Error("padrón de ARBA", "error", err)
			return errEmision("No se pudo leer el archivo: si la subida se cortó, probá de nuevo.")
		}
		if errCopia != nil {
			return errCopia
		}
		if r.Leidos == 0 {
			return errEmision("El archivo no tiene renglones de percepción: no es el padrón de ARBA.")
		}
		// Lo que se pisa con la vigencia nueva se reemplaza: con dos filas
		// vigentes el mismo día, la emisión elegiría una al azar. Lo vencido
		// hace más de dos meses se va: ya no se emite con esa fecha.
		if _, err := tx.Exec(ctx, `DELETE FROM padron_iibb p USING (SELECT DISTINCT desde, hasta FROM padron_nuevo) n
			WHERE p.vigencia_desde <= n.hasta AND p.vigencia_hasta >= n.desde`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM padron_iibb WHERE vigencia_hasta < $1::date - 62`, r.Desde); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO padron_iibb (cuit, alicuota, vigencia_desde, vigencia_hasta)
			SELECT DISTINCT ON (cuit, desde) cuit, alicuota, desde, hasta FROM padron_nuevo ORDER BY cuit, desde, hasta DESC`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO padron_iibb_importaciones (vigencia_desde, vigencia_hasta, renglones, cargado_por)
			VALUES ($1::date, $2::date, $3, nullif($4, ''))`, r.Desde, r.Hasta, r.Leidos, userID); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT count(DISTINCT n.cuit)::int FROM padron_nuevo n
			WHERE n.cuit IN (SELECT regexp_replace(cuit, '\D', '', 'g') FROM customers WHERE cuit IS NOT NULL)`).Scan(&r.Cargados)
	})
	if err != nil {
		return ResultadoDelPadron{}, err
	}
	return r, nil
}

// desdeCanal es el pgx.CopyFromSource de las filas que va leyendo el
// archivo.
type desdeCanal struct {
	filas <-chan []any
	fila  []any
}

func (d *desdeCanal) Next() bool {
	f, ok := <-d.filas
	d.fila = f
	return ok
}
func (d *desdeCanal) Values() ([]any, error) { return d.fila, nil }
func (d *desdeCanal) Err() error             { return nil }

// Padron son las filas de los clientes vigentes hoy o después, por CUIT.
func (s *Servicio) Padron(ctx context.Context) ([]FilaDelPadron, error) {
	hoy := s.ahora().In(fiscal.Argentina).Format("2006-01-02")
	filas, err := s.pool.Query(ctx, `SELECT p.cuit, (SELECT coalesce(nullif(c.razon_social, ''), c.nombre) FROM customers c
		WHERE regexp_replace(c.cuit, '\D', '', 'g') = p.cuit ORDER BY c.created_at LIMIT 1),
		p.alicuota::float8, to_char(p.vigencia_desde, 'YYYY-MM-DD'), to_char(p.vigencia_hasta, 'YYYY-MM-DD')
		FROM padron_iibb p WHERE p.vigencia_hasta >= $1::date
		AND p.cuit IN (SELECT regexp_replace(cuit, '\D', '', 'g') FROM customers WHERE cuit IS NOT NULL)
		ORDER BY p.vigencia_desde DESC, p.cuit`, hoy)
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

// hayPadronVigente dice si hay un padrón importado que cubre ese día. Por la
// importación y no por las filas: el padrón que no tenía a ningún cliente
// era un padrón bien importado.
func hayPadronVigente(ctx context.Context, c consultor, dia time.Time) (bool, error) {
	var hay bool
	err := c.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM padron_iibb_importaciones WHERE vigencia_desde <= $1::date AND vigencia_hasta >= $1::date)`,
		dia.In(fiscal.Argentina).Format("2006-01-02")).Scan(&hay)
	return hay, err
}
