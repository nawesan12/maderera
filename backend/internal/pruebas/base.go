// Package pruebas da una base de Postgres propia a cada test.
//
//	MJBJ_PRUEBA_BASE=postgres://postgres:clave@127.0.0.1:55480/postgres go test ./...
//
// La URL es la de un servidor descartable (con permiso para crear bases).
// La primera vez se arma la plantilla `mjbj_plantilla` con todas las
// migraciones; después, cada test recibe una copia (`CREATE DATABASE …
// TEMPLATE`, unos 50 ms) que se borra al terminar. Sin la variable, los tests
// que piden base se saltean: los de lógica pura corren en cualquier lado.
//
// No usa testcontainers: necesita bajar su propia imagen auxiliar, y no
// siempre hay registro de Docker a mano. Un Postgres de servicio alcanza.
package pruebas

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"log/slog"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"

	"mjbj/db"
	"mjbj/internal/migrar"
)

const plantilla = "mjbj_plantilla"

func conBase(servidor, base string) string {
	u, _ := url.Parse(servidor)
	u.Path = "/" + base
	q := u.Query()
	if q.Get("sslmode") == "" {
		q.Set("sslmode", "disable")
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// Base devuelve un pool contra una base nueva, migrada y vacía.
func Base(t testing.TB) *pgxpool.Pool {
	t.Helper()
	servidor := os.Getenv("MJBJ_PRUEBA_BASE")
	if servidor == "" {
		t.Skip("sin MJBJ_PRUEBA_BASE: este test necesita un Postgres")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, conBase(servidor, "postgres"))
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(ctx)

	// Un candado para que dos paquetes de tests no armen la plantilla a la vez.
	if _, err := admin.Exec(ctx, `select pg_advisory_lock(7210426)`); err != nil {
		t.Fatal(err)
	}
	var existe bool
	_ = admin.QueryRow(ctx, `select exists(select 1 from pg_database where datname = $1)`, plantilla).Scan(&existe)
	if !existe {
		if _, err := admin.Exec(ctx, `create database `+plantilla); err != nil {
			t.Fatal(err)
		}
	}
	// Migrar siempre: si apareció una migración nueva, la plantilla se pone al día.
	cfg, _ := pgx.ParseConfig(conBase(servidor, plantilla))
	sqlDB := stdlib.OpenDB(*cfg)
	_, err = migrar.Correr(ctx, sqlDB, db.Migraciones, slog.New(slog.NewTextHandler(io.Discard, nil)))
	_ = sqlDB.Close()
	if err != nil {
		_, _ = admin.Exec(ctx, `select pg_advisory_unlock(7210426)`)
		t.Fatalf("migrando la plantilla: %v", err)
	}
	var b [6]byte
	_, _ = rand.Read(b[:])
	nombre := "t_" + hex.EncodeToString(b[:])
	_, err = admin.Exec(ctx, `create database `+nombre+` template `+plantilla)
	_, _ = admin.Exec(ctx, `select pg_advisory_unlock(7210426)`)
	if err != nil {
		t.Fatal(err)
	}

	pool, err := pgxpool.New(ctx, conBase(servidor, nombre))
	if err != nil {
		t.Fatal(err)
	}
	// La base vacía no trae los interruptores de la tienda (migración 00093),
	// y sin ellos la tienda está encendida: casi todos los tests prueban el
	// sitio vendiendo. Los de la tienda apagada la apagan con TiendaApagada.
	if _, err := pool.Exec(ctx, `delete from site_settings where clave in ('tienda_activa', 'stock_visible')`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		c, err := pgx.Connect(context.Background(), conBase(servidor, "postgres"))
		if err == nil {
			_, _ = c.Exec(context.Background(), `drop database if exists `+nombre+` with (force)`)
			_ = c.Close(context.Background())
		}
	})
	return pool
}

// TiendaApagada deja el sitio como la primera entrega: sin precios, carrito ni
// disponibilidad (migración 00093).
func TiendaApagada(t testing.TB, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `insert into site_settings (clave, valor) values
		('tienda_activa', 'no'), ('stock_visible', 'no')
		on conflict (clave) do update set valor = excluded.valor`); err != nil {
		t.Fatal(err)
	}
}
