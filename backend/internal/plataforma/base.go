package plataforma

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
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

// Pool abre el pool de conexiones y prueba que la base responda: si no
// responde al arrancar, mejor saberlo ahí que en el primer pedido.
func (c ConfigBase) Pool(ctx context.Context) (*pgxpool.Pool, error) {
	u, err := c.url()
	if err != nil {
		return nil, err
	}
	cfg, err := pgxpool.ParseConfig(u)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = c.Maximo
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
