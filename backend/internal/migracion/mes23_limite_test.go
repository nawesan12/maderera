package migracion

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// Mes 23: re-migrar clientes sin la columna del límite (ni la de la
// condición frente al IVA) dejaba en 0 el límite cargado a mano y pasaba a
// consumidor final al responsable inscripto. Lo que vino en el archivo sí
// se actualiza.
func TestMes23ReMigrarNoBorraElLimite(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `INSERT INTO customers (nombre, cuit, condicion_iva, tipo, limite_credito, email)
		VALUES ('Sim Techos Costa Atlántica SRL', '30-71555111-6', 'responsable_inscripto', 'profesional', 2000000, 'techos@prueba.test')`); err != nil {
		t.Fatal(err)
	}
	migrar(t, e, adm, "clientes", "c.csv", []byte("Nombre;CUIT;Teléfono\r\nSim Techos Costa Atlántica SRL;30715551116;223 555-0101\r\n"))
	var limite float64
	var condicion, tipo, email, telefono string
	if err := e.pool.QueryRow(ctx, `SELECT limite_credito::float8, condicion_iva::text, tipo::text, coalesce(email, ''), coalesce(telefono, '')
		FROM customers WHERE nombre = 'Sim Techos Costa Atlántica SRL'`).Scan(&limite, &condicion, &tipo, &email, &telefono); err != nil {
		t.Fatal(err)
	}
	if limite != 2000000 || condicion != "responsable_inscripto" || tipo != "profesional" || email != "techos@prueba.test" || telefono != "223 555-0101" {
		t.Errorf("después de re-migrar: límite %v, %s, %s, %q, %q", limite, condicion, tipo, email, telefono)
	}
	if n := contarFilas(t, e.pool, `SELECT count(*) FROM customers`); n != 1 {
		t.Errorf("se duplicó: %d", n)
	}

	// Con la columna, el límite del archivo manda (también un 0).
	migrar(t, e, adm, "clientes", "c.csv", []byte("Nombre;CUIT;Límite\r\nSim Techos Costa Atlántica SRL;30715551116;0\r\n"))
	if err := e.pool.QueryRow(ctx, `SELECT limite_credito::float8 FROM customers`).Scan(&limite); err != nil || limite != 0 {
		t.Errorf("con la columna del límite: %v %v", limite, err)
	}
	// Un alta sin la columna nace en 0, consumidor final y particular.
	migrar(t, e, adm, "clientes", "d.csv", []byte("Nombre\r\nSim Patricia Díaz\r\n"))
	if err := e.pool.QueryRow(ctx, `SELECT limite_credito::float8, condicion_iva::text, tipo::text FROM customers WHERE nombre = 'Sim Patricia Díaz'`).Scan(&limite, &condicion, &tipo); err != nil ||
		limite != 0 || condicion != "consumidor_final" || tipo != "particular" {
		t.Errorf("alta: %v %s %s %v", limite, condicion, tipo, err)
	}
}

// Mes 23: la fila que pisa una ficha decía «Teléfono → vacío» (y el teléfono
// quedaba), no decía que el tipo pasaba de profesional a particular, y un
// tipo que no se reconocía dejaba particular a un profesional.
func TestMes23LaVistaPreviaDiceLoQueEscribe(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	ctx := context.Background()
	u := e.srv.URL + "/api/v1/admin/migracion/"
	if _, err := e.pool.Exec(ctx, `INSERT INTO customers (nombre, cuit, tipo, telefono, direccion)
		VALUES ('Sim Techos', '30-71555022-5', 'profesional', '223 555-0101', 'Sim Ruta 11 km 5')`); err != nil {
		t.Fatal(err)
	}
	previa := func(archivo string) []string {
		t.Helper()
		var a ArchivoAnalizado
		if s := subir(t, adm, u+"analizar", "clientes", "c.csv", []byte(archivo), &a); s != 200 || a.Error != "" {
			t.Fatalf("analizar: %d %q", s, a.Error)
		}
		var v VistaPrevia
		if s := pedir(t, adm, "POST", u+"previa", map[string]any{"entidad": "clientes", "mapeo": a.Mapeo, "filas": a.Filas}, &v); s != 200 || v.Muestra == nil || len(*v.Muestra) != 1 {
			t.Fatalf("previa: %d %+v", s, v)
		}
		return (*v.Muestra)[0].Cambios
	}
	tipoYTelefono := func() (string, string) {
		var tipo, tel string
		if err := e.pool.QueryRow(ctx, `SELECT tipo::text, coalesce(telefono, '') FROM customers`).Scan(&tipo, &tel); err != nil {
			t.Fatal(err)
		}
		return tipo, tel
	}

	// Sin la columna del teléfono y con un tipo que no se reconoce: solo
	// cambia el domicilio, y así queda.
	sinTel := "Nombre;CUIT;Domicilio;Tipo\r\nSim Techos;30715550225;Sim Ruta 11;Galáctico\r\n"
	if c := strings.Join(previa(sinTel), "|"); c != "Domicilio: Sim Ruta 11 km 5 → Sim Ruta 11" {
		t.Errorf("cambios sin teléfono: %q", c)
	}
	migrar(t, e, adm, "clientes", "c.csv", []byte(sinTel))
	if tipo, tel := tipoYTelefono(); tipo != "profesional" || tel != "223 555-0101" {
		t.Errorf("después de migrar: %s %q", tipo, tel)
	}

	// Con el tipo escrito, el cambio se anuncia y se hace.
	conTipo := "Nombre;CUIT;Tipo\r\nSim Techos;30715550225;Particular\r\n"
	if c := strings.Join(previa(conTipo), "|"); c != "Tipo: Profesional → Particular" {
		t.Errorf("cambios con el tipo: %q", c)
	}
	migrar(t, e, adm, "clientes", "c.csv", []byte(conTipo))
	if tipo, tel := tipoYTelefono(); tipo != "particular" || tel != "223 555-0101" {
		t.Errorf("con el tipo: %s %q", tipo, tel)
	}
}
