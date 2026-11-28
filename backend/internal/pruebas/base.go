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
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/url"
	"os"
	"path"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"mjbj/db"
	"mjbj/internal/migrar"
)

// La plantilla se puede cambiar con MJBJ_PRUEBA_PLANTILLA: ramas que trabajan
// en paralelo con migraciones distintas no pueden compartir la misma, porque
// cada una la migra a su gusto y las pruebas de la otra ven columnas ajenas.
var plantilla = func() string {
	if p := os.Getenv("MJBJ_PRUEBA_PLANTILLA"); p != "" {
		return p
	}
	return "mjbj_plantilla"
}()

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

// candadoDePlantilla es el pg_advisory_lock bajo el que se arma la
// plantilla y se copia.
const candadoDePlantilla = 7210426

// PrepararPlantilla deja la plantilla al día; quien llama tiene tomado el
// candado. Si no existe, la crea; si migrarla falla —una migración que quedó
// salteada y ya no se puede aplicar encima, como la 00090 aplicada antes que
// la 00089— o trae versiones que esta rama no tiene (las migró otra rama con
// la misma plantilla, y sus columnas confundirían a las pruebas), la borra y
// la arma de nuevo desde cero. Es una base de pruebas: rearmarla cuesta lo
// que tardan las migraciones y no pierde nada.
func PrepararPlantilla(ctx context.Context, admin *pgx.Conn, servidor, nombre string, migraciones fs.FS) error {
	var existe bool
	if err := admin.QueryRow(ctx, `select exists(select 1 from pg_database where datname = $1)`, nombre).Scan(&existe); err != nil {
		return err
	}
	if !existe {
		if _, err := admin.Exec(ctx, `create database `+pgx.Identifier{nombre}.Sanitize()); err != nil {
			return err
		}
	}
	// Migrar siempre: si apareció una migración nueva, la plantilla se pone al día.
	err := migrarPlantilla(ctx, servidor, nombre, migraciones)
	if err == nil || !existe {
		return err
	}
	if _, err := admin.Exec(ctx, `drop database `+pgx.Identifier{nombre}.Sanitize()+` with (force)`); err != nil {
		return err
	}
	if _, err := admin.Exec(ctx, `create database `+pgx.Identifier{nombre}.Sanitize()); err != nil {
		return err
	}
	return migrarPlantilla(ctx, servidor, nombre, migraciones)
}

// migrarPlantilla corre las migraciones, y falla si la plantilla tiene
// alguna aplicada que esta rama no conoce.
func migrarPlantilla(ctx context.Context, servidor, nombre string, migraciones fs.FS) error {
	cfg, err := pgx.ParseConfig(conBase(servidor, nombre))
	if err != nil {
		return err
	}
	sqlDB := stdlib.OpenDB(*cfg)
	defer sqlDB.Close()
	if ajenas, err := versionesAjenas(ctx, sqlDB, migraciones); err != nil {
		return err
	} else if len(ajenas) > 0 {
		return fmt.Errorf("la plantilla tiene migraciones que esta rama no tiene: %v", ajenas)
	}
	if _, err = migrar.Correr(ctx, sqlDB, migraciones, slog.New(slog.NewTextHandler(io.Discard, nil))); err != nil {
		return err
	}
	// Las pruebas arman sus propias sucursales (casa-central, aserradero y
	// las que necesiten, con sus ids y su orden): las dos que siembra la
	// 00204 para una base nueva chocarían con el slug único. La 00204 se
	// prueba aparte (migrar.TestLasDosSucursales). Lo mismo los regímenes de
	// retención que siembra la 00361 (db.TestMigracion00361): las pruebas
	// arman los suyos con sus códigos.
	if _, err = sqlDB.ExecContext(ctx, `DELETE FROM branches`); err != nil {
		return err
	}
	_, err = sqlDB.ExecContext(ctx, `DELETE FROM regimenes_retencion WHERE NOT EXISTS (SELECT 1 FROM retenciones_practicadas p WHERE p.regimen_id = regimenes_retencion.id)`)
	return err
}

// versionesAjenas son las versiones aplicadas en la base que no están entre
// los archivos (las de drizzle, de antes de goose, no cuentan).
func versionesAjenas(ctx context.Context, base *sql.DB, migraciones fs.FS) ([]int64, error) {
	var hay bool
	if err := base.QueryRowContext(ctx, `select to_regclass('goose_db_version') is not null`).Scan(&hay); err != nil || !hay {
		return nil, err
	}
	archivos, err := fs.Glob(migraciones, "migraciones/*.sql")
	if err != nil {
		return nil, err
	}
	propias := map[int64]bool{0: true}
	for _, a := range archivos {
		if v, err := goose.NumericComponent(path.Base(a)); err == nil {
			propias[v] = true
		}
	}
	filas, err := base.QueryContext(ctx, `select distinct version_id from goose_db_version where is_applied order by 1`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	var ajenas []int64
	for filas.Next() {
		var v int64
		if err := filas.Scan(&v); err != nil {
			return nil, err
		}
		if !propias[v] {
			ajenas = append(ajenas, v)
		}
	}
	return ajenas, filas.Err()
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
	if _, err := admin.Exec(ctx, `select pg_advisory_lock($1)`, candadoDePlantilla); err != nil {
		t.Fatal(err)
	}
	if err := PrepararPlantilla(ctx, admin, servidor, plantilla, db.Migraciones); err != nil {
		_, _ = admin.Exec(ctx, `select pg_advisory_unlock($1)`, candadoDePlantilla)
		t.Fatalf("migrando la plantilla: %v", err)
	}
	var b [6]byte
	_, _ = rand.Read(b[:])
	nombre := "t_" + hex.EncodeToString(b[:])
	_, err = admin.Exec(ctx, `create database `+nombre+` template `+plantilla)
	_, _ = admin.Exec(ctx, `select pg_advisory_unlock($1)`, candadoDePlantilla)
	if err != nil {
		t.Fatal(err)
	}

	// El pool del tamaño del de producción (DATABASE_POOL_MAX, 20), no el
	// de pgx por omisión, que es max(4, núcleos): en la Mac daba 10 o más y
	// en el runner de GitHub (4 núcleos) 4. Las pruebas de concurrencia que
	// abren diez conexiones de una se quedaban esperando la quinta para
	// siempre, y solo en la CI.
	cfgPool, err := pgxpool.ParseConfig(conBase(servidor, nombre))
	if err != nil {
		t.Fatal(err)
	}
	cfgPool.MaxConns = 20
	pool, err := pgxpool.NewWithConfig(ctx, cfgPool)
	if err != nil {
		t.Fatal(err)
	}
	// La base vacía no trae los interruptores de la tienda (migración 00093),
	// y sin ellos la tienda está encendida: casi todos los tests prueban el
	// sitio vendiendo. Los de la tienda apagada la apagan con TiendaApagada.
	if _, err := pool.Exec(ctx, `delete from site_settings where clave in ('tienda_activa', 'stock_visible', 'whatsapp_bot', 'whatsapp_numero_humano')`); err != nil {
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
