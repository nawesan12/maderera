package plataforma

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
)

// ConfigBase es la conexión a Postgres. Los nombres son los mismos que usa la
// aplicación de Next, para que el compose les pase lo mismo a los dos.
type ConfigBase struct {
	URL string `env:"DATABASE_URL,required"`
	// Conexiones del pool. Next usa 10 por omisión; mientras convivan, la suma
	// de los dos tiene que entrar en el `max_connections` de Postgres (100).
	Maximo int32 `env:"DATABASE_POOL_MAX" envDefault:"20"`
	// "off" en el servidor propio (la base está en la misma red y no tiene
	// certificado); cualquier otra cosa deja lo que diga la URL.
	SSL string `env:"DATABASE_SSL"`
}

func (c ConfigBase) url() (string, error) {
	u, err := url.Parse(c.URL)
	if err != nil {
		return "", fmt.Errorf("DATABASE_URL no es una URL: %w", err)
	}
	if c.SSL == "off" {
		q := u.Query()
		if q.Get("sslmode") == "" {
			q.Set("sslmode", "disable")
			u.RawQuery = q.Encode()
		}
	}
	return u.String(), nil
}

// URLConexion es la URL con el ajuste de SSL aplicado, para quien necesita
// una conexión suelta (el LISTEN del tiempo real).
func (c ConfigBase) URLConexion() (string, error) { return c.url() }

// Topes son los límites de cada conexión de un pool. Cero es «sin tope»
// (lo que diga el servidor).
type Topes struct {
	// Conexiones del pool; cero es DATABASE_POOL_MAX.
	Maximo int32
	// Sentencia es statement_timeout: lo más que puede tardar una consulta.
	Sentencia time.Duration
	// Candado es lock_timeout: lo más que una consulta espera un candado
	// que tiene otro. Es lo que hace que dos cajas a la vez no se queden
	// trabadas esperándose: la segunda recibe un error en vez de colgarse.
	Candado time.Duration
	// Ociosa es idle_in_transaction_session_timeout: una transacción
	// abierta que no hace nada (un proceso que se colgó a mitad) se corta y
	// suelta sus candados.
	Ociosa time.Duration
	// SoloLectura deja cada transacción en solo lectura: la base misma
	// rechaza un INSERT, así nadie mueve plata por el pool de los reportes.
	SoloLectura bool
}

// parametros son los de la conexión para estos topes.
func (t Topes) parametros() map[string]string {
	p := map[string]string{}
	ms := func(d time.Duration) string { return strconv.FormatInt(d.Milliseconds(), 10) }
	if t.Sentencia > 0 {
		p["statement_timeout"] = ms(t.Sentencia)
	}
	if t.Candado > 0 {
		p["lock_timeout"] = ms(t.Candado)
	}
	if t.Ociosa > 0 {
		p["idle_in_transaction_session_timeout"] = ms(t.Ociosa)
	}
	if t.SoloLectura {
		p["default_transaction_read_only"] = "on"
	}
	return p
}

// Pool abre el pool de conexiones y prueba que la base responda: si no
// responde al arrancar, mejor saberlo ahí que en el primer pedido.
func (c ConfigBase) Pool(ctx context.Context) (*pgxpool.Pool, error) {
	return c.PoolCon(ctx, Topes{})
}

// PoolCon es Pool con topes: los parámetros van en el arranque de cada
// conexión, así valen también para la que el pool abre más tarde.
func (c ConfigBase) PoolCon(ctx context.Context, t Topes) (*pgxpool.Pool, error) {
	u, err := c.url()
	if err != nil {
		return nil, err
	}
	cfg, err := pgxpool.ParseConfig(u)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = c.Maximo
	if t.Maximo > 0 {
		cfg.MaxConns = t.Maximo
	}
	for k, v := range t.parametros() {
		cfg.ConnConfig.RuntimeParams[k] = v
	}
	cfg.MaxConnIdleTime = 30 * time.Second
	cfg.ConnConfig.ConnectTimeout = 10 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("la base no responde: %w", err)
	}
	return pool, nil
}

// SQL abre la base como database/sql, que es lo que pide goose.
func (c ConfigBase) SQL() (*sql.DB, error) {
	u, err := c.url()
	if err != nil {
		return nil, err
	}
	cfg, err := pgxpool.ParseConfig(u)
	if err != nil {
		return nil, err
	}
	return stdlib.OpenDB(*cfg.ConnConfig), nil
}

// SinTopes saca el statement_timeout y el lock_timeout de una conexión
// tomada del pool, y devuelve con qué volver a ponerlos antes de soltarla.
//
// Es para los candados de sesión que se esperan mientras otro habla con
// afuera —el CAE con ARCA, el turno del bot con el modelo—: esa espera puede
// pasar los 10 s del principal sin que nada ande mal, y la acota el contexto
// del pedido, que pgx cancela en la base. Si no se pueden volver a poner, la
// conexión se cierra: no vuelve al pool sin sus topes.
func SinTopes(ctx context.Context, c *pgxpool.Conn) (restaurar func(), err error) {
	if _, err := c.Exec(ctx, `SET statement_timeout = 0`); err != nil {
		return nil, err
	}
	if _, err := c.Exec(ctx, `SET lock_timeout = 0`); err != nil {
		return nil, err
	}
	return func() {
		ctx := context.WithoutCancel(ctx)
		if _, err := c.Exec(ctx, `RESET statement_timeout`); err != nil {
			_ = c.Conn().Close(ctx)
			return
		}
		if _, err := c.Exec(ctx, `RESET lock_timeout`); err != nil {
			_ = c.Conn().Close(ctx)
		}
	}, nil
}
