package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
)

// El gasto del mes en Meta contra el tope (lib/whatsapp/gasto.ts). Lo leen
// los avisos automáticos (que dejan de salir al llegar al tope),
// EnviarYRegistrar (que pide confirmación a la bandeja), la configuración y
// la bandeja: la misma cuenta en todos lados.

// ConfigDeGasto es el tope y las tarifas guardadas.
type ConfigDeGasto struct {
	Tope              float64
	Tarifas           map[string]float64
	Aviso80, Aviso100 *string
}

// ConfigDeGasto lee la fila de la sesión.
func (s *Servicio) ConfigDeGasto(ctx context.Context) (ConfigDeGasto, error) {
	var tope *jsmath.Num
	var tarifas []byte
	var a80, a100 *string
	err := s.pool.QueryRow(ctx, `select tope_mensual_usd, tarifas, tope_aviso80, tope_aviso100 from whatsapp_sesion limit 1`).
		Scan(&tope, &tarifas, &a80, &a100)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return ConfigDeGasto{}, err
	}
	t := TopePorOmision
	if tope != nil {
		t = tope.F()
	}
	if math.IsNaN(t) || math.IsInf(t, 0) || t < 0 {
		t = TopePorOmision
	}
	var guardadas map[string]any
	_ = json.Unmarshal(tarifas, &guardadas)
	return ConfigDeGasto{Tope: t, Tarifas: TarifasEfectivas(guardadas), Aviso80: a80, Aviso100: a100}, nil
}

// GastoDelMes es lo gastado en el mes argentino en curso, contra el tope.
type GastoDelMes struct {
	Gasto
	EstadoDelTope
	Tope     float64            `json:"tope"`
	Mes      string             `json:"mes"`
	Reinicio time.Time          `json:"reinicio"`
	Tarifas  map[string]float64 `json:"tarifas"`
}

// GastoDelMes cuenta los salientes con el cobro que informó Meta y,
// aparte, los que salieron por la API y todavía no tienen estado
// (estimados: plantilla → utilidad, texto → servicio). Lo del teléfono, lo
// importado y lo de la demostración no se cuentan.
func (s *Servicio) GastoDelMes(ctx context.Context, ahora time.Time) (GastoDelMes, error) {
	inicio := InicioDelMesArgentino(ahora)
	cfg, err := s.ConfigDeGasto(ctx)
	if err != nil {
		return GastoDelMes{}, err
	}
	const porAPI = `direccion = 'saliente' and created_at >= $1 and importado = false and (origen is null or origen <> 'telefono')`
	filas := []FilaDeGasto{}
	r, err := s.pool.Query(ctx, `select cobro_categoria, cobrable, count(*)::int from whatsapp_mensajes
		where `+porAPI+` and cobro_categoria is not null group by cobro_categoria, cobrable`, inicio)
	if err != nil {
		return GastoDelMes{}, err
	}
	for r.Next() {
		var f FilaDeGasto
		var n int
		if err := r.Scan(&f.Categoria, &f.Cobrable, &n); err != nil {
			r.Close()
			return GastoDelMes{}, err
		}
		f.Total = float64(n)
		filas = append(filas, f)
	}
	r.Close()
	r, err = s.pool.Query(ctx, `select plantilla is not null, count(*)::int from whatsapp_mensajes
		where `+porAPI+` and cobro_categoria is null and wa_message_id is not null and wa_message_id not like 'demo-%'
		  and estado in ('enviado', 'entregado', 'leido') group by plantilla is not null`, inicio)
	if err != nil {
		return GastoDelMes{}, err
	}
	for r.Next() {
		var plantilla bool
		var n int
		if err := r.Scan(&plantilla, &n); err != nil {
			r.Close()
			return GastoDelMes{}, err
		}
		cat := "service"
		if plantilla {
			cat = "utility"
		}
		filas = append(filas, FilaDeGasto{Categoria: ptr(cat), Total: float64(n), Estimado: true})
	}
	r.Close()
	g := CalcularGasto(filas, cfg.Tarifas)
	return GastoDelMes{Gasto: g, EstadoDelTope: EstadoDeTope(g.USD, cfg.Tope), Tope: cfg.Tope, Mes: MesArgentino(ahora),
		Reinicio: InicioDelMesSiguienteArgentino(ahora), Tarifas: cfg.Tarifas}, nil
}

// TopeAlcanzado dice si ya se llegó al tope del mes. Ante la duda (la base
// no contesta), no.
func (s *Servicio) TopeAlcanzado(ctx context.Context) bool {
	g, err := s.GastoDelMes(ctx, s.ahora())
	return err == nil && g.Alcanzado
}

// RevisarUmbrales avisa al teléfono del admin al pasar el 80 % y el 100 %:
// una vez por umbral y por mes. La marca va con un `update … where` que
// devuelve la fila solo a quien la cambió. No falla: es un extra.
func (s *Servicio) RevisarUmbrales(ctx context.Context) {
	g, err := s.GastoDelMes(ctx, s.ahora())
	if err != nil {
		s.log.Error("whatsapp: gasto", "error", err)
		return
	}
	pasados := UmbralesPasados(g.USD, g.Tope)
	if len(pasados) == 0 {
		return
	}
	umbral := pasados[len(pasados)-1]
	consulta := `update whatsapp_sesion set tope_aviso80 = $1 where tope_aviso80 is null or tope_aviso80 <> $1 returning id`
	if umbral == 100 {
		consulta = `update whatsapp_sesion set tope_aviso100 = $1, tope_aviso80 = $1 where tope_aviso100 is null or tope_aviso100 <> $1 returning id`
	}
	r, err := s.pool.Query(ctx, consulta, g.Mes)
	if err != nil {
		s.log.Error("whatsapp: umbral", "error", err)
		return
	}
	marcadas := 0
	for r.Next() {
		marcadas++
	}
	r.Close()
	if marcadas == 0 {
		return
	}
	s.log.Info("whatsapp: umbral", "umbral", umbral, "usd", g.USD, "tope", g.Tope)
	s.avisar(ctx, avisoTope(umbral, g.USD, g.Tope))
}
