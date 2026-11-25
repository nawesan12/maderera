package entregas

import (
	"context"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Las zonas de envío del panel (app/admin/envios): todas, para editarlas.
// Lo que se le ofrece al cliente (solo las activas) lo lee internal/contenido.

// ZonaDeEnvio es una fila de shipping_zones, con los numeric como texto
// (como los leía drizzle: el editor los muestra tal cual).
type ZonaDeEnvio struct {
	ID               string  `json:"id"`
	Nombre           string  `json:"nombre"`
	Cobertura        string  `json:"cobertura"`
	DemoraEstimada   *string `json:"demoraEstimada"`
	ACotizar         bool    `json:"aCotizar"`
	Costo            string  `json:"costo"`
	EnvioGratisDesde string  `json:"envioGratisDesde"`
	Orden            string  `json:"orden"`
	Activa           bool    `json:"activa"`
}

// Zonas son todas, por orden y nombre.
func (s *Servicio) Zonas(ctx context.Context) ([]ZonaDeEnvio, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT id, nombre, cobertura, demora_estimada, a_cotizar, costo::text, envio_gratis_desde::text, orden::text, activa
		FROM shipping_zones ORDER BY orden, nombre`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []ZonaDeEnvio{}
	for filas.Next() {
		var z ZonaDeEnvio
		if err := filas.Scan(&z.ID, &z.Nombre, &z.Cobertura, &z.DemoraEstimada, &z.ACotizar, &z.Costo, &z.EnvioGratisDesde, &z.Orden, &z.Activa); err != nil {
			return nil, err
		}
		out = append(out, z)
	}
	return out, filas.Err()
}

// GuardarZona da de alta o edita una zona (con el id), y lo anota. Editar
// una que no existe no hace nada, como el TS.
func (s *Servicio) GuardarZona(ctx context.Context, ses *auth.Sesion, m map[string]any) error {
	z, campo, msj := LeerZona(m)
	if msj == "" {
		campo, msj = z.Valores.FueraDeRango()
	}
	if msj != "" {
		if campo == "" {
			campo = "_"
		}
		return plataforma.Invalido(map[string]string{campo: msj})
	}
	v := z.Valores
	var err error
	if z.ID != nil {
		_, err = s.pool.Exec(ctx, `
			UPDATE shipping_zones SET nombre = $2, cobertura = $3, demora_estimada = $4, a_cotizar = $5, costo = $6::numeric,
			  envio_gratis_desde = $7::numeric, orden = $8::numeric, activa = $9
			WHERE id = $1`, *z.ID, v.Nombre, v.Cobertura, v.DemoraEstimada, v.ACotizar, v.Costo, v.EnvioGratisDesde, v.Orden, v.Activa)
	} else {
		_, err = s.pool.Exec(ctx, `
			INSERT INTO shipping_zones (nombre, cobertura, demora_estimada, a_cotizar, costo, envio_gratis_desde, orden, activa)
			VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8)`,
			v.Nombre, v.Cobertura, v.DemoraEstimada, v.ACotizar, v.Costo, v.EnvioGratisDesde, v.Orden, v.Activa)
	}
	if err != nil {
		return err
	}
	accion, id := sqlc.AccionAuditoriaCrear, ""
	if z.ID != nil {
		accion, id = sqlc.AccionAuditoriaEditar, *z.ID
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, "zona_envio", id, z.Descripcion, v)
	return nil
}
