package reportes

import (
	"encoding/json"
	"net/http"
	"testing"
)

// /admin/sistema existe (M2S2-061): el aviso de un trabajo fallido llevaba a
// un 404. Muestra el trabajo con su error y la última corrida de cada tarea;
// el fallido se puede volver a intentar, y solo el admin entra.
func TestElSistemaMuestraLoQueFallo(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	id := e.id(t, `insert into trabajos (tipo, carga, estado, intentos, ultimo_error, terminado_at) values
		('email.reintento', '{}', 'fallido', 8, 'SMTP 550', now()) returning id`)
	e.exec(t, `insert into trabajos (tipo, carga, estado) values ('revalidar', '{}', 'hecho')`)
	e.exec(t, `insert into tareas_corridas (tarea, periodo, estado, error) values ('vencer-portada', '2026-11-26T05', 'ok', null),
		('parte-y-limpieza', '2026-11-26', 'error', 'sin conexión')`)

	if c, _, _ := pedir(t, ven, e.u+"sistema"); c != 403 {
		t.Fatalf("el vendedor no entra: %d", c)
	}
	_, cuerpo, _ := pedir(t, adm, e.u+"sistema")
	var v EstadoDelSistema
	if err := json.Unmarshal([]byte(cuerpo), &v); err != nil {
		t.Fatal(cuerpo)
	}
	if len(v.Trabajos) != 1 || v.Trabajos[0].ID != id || v.Trabajos[0].UltimoError == nil || len(v.Tareas) != 2 {
		t.Fatalf("sistema: %+v", v)
	}
	req, _ := http.NewRequest("POST", e.u+"sistema/trabajos/"+id+"/reintentar", nil)
	resp, err := adm.Do(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("reintentar: %v %v", err, resp.StatusCode)
	}
	resp.Body.Close()
	var estado string
	var intentos int
	if err := e.pool.QueryRow(t.Context(), `select estado::text, intentos from trabajos where id = $1`, id).Scan(&estado, &intentos); err != nil ||
		estado != "pendiente" || intentos != 0 {
		t.Errorf("vuelve a la cola: %s %d %v", estado, intentos, err)
	}
	resp, _ = adm.Do(req)
	if resp.StatusCode != 404 {
		t.Errorf("dos veces: %d", resp.StatusCode)
	}
	resp.Body.Close()
}
