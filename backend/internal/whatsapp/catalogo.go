package whatsapp

import (
	"context"
	"encoding/json"
	"time"
)

// Las plantillas, guardadas y listas para ofrecer (lib/whatsapp/catalogo.ts).
// Se copian de Meta a whatsapp_plantillas y la bandeja lee de ahí: abrir una
// conversación no puede depender de que la Graph API conteste. La copia se
// actualiza con el botón de la configuración, la tarea diaria del worker y el
// webhook `message_template_status_update`.

// ResultadoSincronizacion es cuántas se trajeron.
type ResultadoSincronizacion struct {
	Total     int    `json:"total"`
	Aprobadas int    `json:"aprobadas"`
	Error     string `json:"error,omitempty"`
}

// SincronizarPlantillas trae las plantillas de Meta.
func (s *Servicio) SincronizarPlantillas(ctx context.Context) (ResultadoSincronizacion, error) {
	if s.prov.ID() == "demo" {
		return ResultadoSincronizacion{Error: "En demostración no hay plantillas de Meta para traer."}, nil
	}
	remotas, err := s.prov.ListarPlantillas(ctx)
	if err != nil {
		return ResultadoSincronizacion{Error: err.Error()}, nil
	}
	ahora := s.ahora()
	vigentes := []string{}
	aprobadas := 0
	for _, p := range remotas {
		comps, _ := json.Marshal(p.Componentes)
		if _, err := s.pool.Exec(ctx, `
			insert into whatsapp_plantillas (meta_id, nombre, idioma, categoria, estado, motivo_rechazo, formato_parametros, componentes, sincronizada_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			on conflict (nombre, idioma) do update set meta_id = excluded.meta_id, categoria = excluded.categoria, estado = excluded.estado,
				motivo_rechazo = excluded.motivo_rechazo, formato_parametros = excluded.formato_parametros,
				componentes = excluded.componentes, sincronizada_at = excluded.sincronizada_at`,
			p.MetaID, p.Nombre, p.Idioma, p.Categoria, p.Estado, p.MotivoRechazo, p.FormatoParametros, comps, ahora); err != nil {
			return ResultadoSincronizacion{}, err
		}
		vigentes = append(vigentes, p.Nombre+"|"+p.Idioma)
		if p.Estado == "APPROVED" {
			aprobadas++
		}
	}
	// Las que se borraron en Meta dejan de ofrecerse.
	if _, err := s.pool.Exec(ctx, `delete from whatsapp_plantillas where not (nombre || '|' || idioma = any($1))`, vigentes); err != nil {
		return ResultadoSincronizacion{}, err
	}
	return ResultadoSincronizacion{Total: len(remotas), Aprobadas: aprobadas}, nil
}

// ActualizarEstadoPlantilla es lo que avisa el webhook. Una que no teníamos
// se trae entera.
func (s *Servicio) ActualizarEstadoPlantilla(ctx context.Context, nombre string, idioma *string, estado string, motivo *string) error {
	var m *string
	if motivo != nil && *motivo != "NONE" && *motivo != "" {
		m = motivo
	}
	t, err := s.pool.Exec(ctx, `update whatsapp_plantillas set estado = $3, motivo_rechazo = $4, sincronizada_at = now()
		where nombre = $1 and ($2::text is null or idioma = $2)`, nombre, nulo(idioma), estado, m)
	if err != nil {
		return err
	}
	if t.RowsAffected() == 0 {
		_, err = s.SincronizarPlantillas(ctx)
	}
	return err
}

func nulo(p *string) *string {
	if vacio(p) {
		return nil
	}
	return p
}

// PlantillaDisponible es una plantilla aprobada, con para qué es si es nuestra.
type PlantillaDisponible struct {
	Plantilla
	Uso *string `json:"uso"`
}

func usoDe(nombre string) *string {
	if b := PlantillaDeBase(nombre); b != nil {
		return &b.Uso
	}
	return nil
}

// PlantillasDisponibles son las que se pueden mandar ahora: las aprobadas
// sincronizadas, o el catálogo base en demostración.
func (s *Servicio) PlantillasDisponibles(ctx context.Context) ([]PlantillaDisponible, error) {
	if s.prov.ID() == "demo" {
		out := []PlantillaDisponible{}
		for _, b := range PlantillasBase {
			out = append(out, PlantillaDisponible{b.Leida(), ptr(b.Uso)})
		}
		return out, nil
	}
	filas, err := s.plantillasAprobadas(ctx)
	if err != nil {
		return nil, err
	}
	// Recién conectado nunca se sincronizó: se traen la primera vez.
	if len(filas) == 0 {
		var hay bool
		if err := s.pool.QueryRow(ctx, `select exists(select 1 from whatsapp_plantillas)`).Scan(&hay); err != nil {
			return nil, err
		}
		if !hay {
			if _, err := s.SincronizarPlantillas(ctx); err != nil {
				return nil, err
			}
			if filas, err = s.plantillasAprobadas(ctx); err != nil {
				return nil, err
			}
		}
	}
	return filas, nil
}

func (s *Servicio) plantillasAprobadas(ctx context.Context) ([]PlantillaDisponible, error) {
	r, err := s.pool.Query(ctx, `select nombre, idioma, categoria, estado, formato_parametros, componentes
		from whatsapp_plantillas where estado = 'APPROVED' order by nombre`)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	out := []PlantillaDisponible{}
	for r.Next() {
		var nombre, idioma, estado, formatoP string
		var categoria *string
		var comps []byte
		if err := r.Scan(&nombre, &idioma, &categoria, &estado, &formatoP, &comps); err != nil {
			return nil, err
		}
		out = append(out, PlantillaDisponible{LeerPlantilla(nombre, idioma, categoria, &estado, &formatoP, comps), usoDe(nombre)})
	}
	return out, r.Err()
}

// PlantillaDisponible es una aprobada por nombre (y el idioma, si hay varios).
func (s *Servicio) PlantillaDisponible(ctx context.Context, nombre, idioma string) (*PlantillaDisponible, error) {
	todas, err := s.PlantillasDisponibles(ctx)
	if err != nil {
		return nil, err
	}
	for i := range todas {
		if todas[i].Nombre == nombre && (idioma == "" || todas[i].Idioma == idioma) {
			return &todas[i], nil
		}
	}
	for i := range todas {
		if todas[i].Nombre == nombre {
			return &todas[i], nil
		}
	}
	return nil, nil
}

// PlantillaGuardada es una fila de whatsapp_plantillas, para la configuración.
type PlantillaGuardada struct {
	ID                string          `json:"id"`
	MetaID            *string         `json:"metaId"`
	Nombre            string          `json:"nombre"`
	Idioma            string          `json:"idioma"`
	Categoria         *string         `json:"categoria"`
	Estado            string          `json:"estado"`
	MotivoRechazo     *string         `json:"motivoRechazo"`
	FormatoParametros string          `json:"formatoParametros"`
	Componentes       json.RawMessage `json:"componentes"`
	SincronizadaAt    time.Time       `json:"sincronizadaAt"`
}

// PlantillasGuardadas son todas, con su estado.
func (s *Servicio) PlantillasGuardadas(ctx context.Context) ([]PlantillaGuardada, error) {
	r, err := s.pool.Query(ctx, `select id, meta_id, nombre, idioma, categoria, estado, motivo_rechazo, formato_parametros, componentes, sincronizada_at
		from whatsapp_plantillas order by nombre`)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	out := []PlantillaGuardada{}
	for r.Next() {
		var p PlantillaGuardada
		if err := r.Scan(&p.ID, &p.MetaID, &p.Nombre, &p.Idioma, &p.Categoria, &p.Estado, &p.MotivoRechazo, &p.FormatoParametros, &p.Componentes, &p.SincronizadaAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, r.Err()
}
