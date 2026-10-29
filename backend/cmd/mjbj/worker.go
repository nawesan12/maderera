package main

import (
	"context"
	"errors"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	avisosT10 "mjbj/internal/avisos"
	"mjbj/internal/campanas"
	"mjbj/internal/cola"
	"mjbj/internal/contenido"
	"mjbj/internal/email"
	"mjbj/internal/plataforma"
	"mjbj/internal/productos"
	"mjbj/internal/profesionales"
	"mjbj/internal/push"
	"mjbj/internal/revalidar"
	"mjbj/internal/sqlc"
	"mjbj/internal/tareas"
	"mjbj/internal/whatsapp"
)

type configWorker struct {
	Base      plataforma.ConfigBase
	Revalidar revalidar.Config
	Push      push.Config
	Google    contenido.ConfigGoogle
	WhatsApp  whatsapp.Config
	Email     email.Config
	Campanas  campanas.Config
}

// El worker: la cola (los tipos que ya son de Go) y las tareas periódicas
// que ya se mudaron. Reemplaza de a poco al contenedor `cron`, que le pega a
// /api/tareas de Next.
func correrWorker() error {
	log := plataforma.Registro("worker")
	cfg, err := plataforma.Cargar[configWorker]()
	if err != nil {
		return err
	}
	ctx, parar := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer parar()
	pool, err := cfg.Base.Pool(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	q := sqlc.New(pool)

	avisos := push.Nuevo(cfg.Push, q, log)
	c := cola.Nueva(q, log)
	c.AlFallar = func(ctx context.Context, tipo, mensaje string) {
		if len(mensaje) > 140 {
			mensaje = mensaje[:140]
		}
		avisos.Avisar(ctx, push.Aviso{
			Titulo: "Un trabajo automático no se pudo hacer", Cuerpo: tipo + ": " + mensaje,
			URL: "/admin/sistema", Etiqueta: "trabajo-fallido",
		})
	}
	c.Registrar(revalidar.Tipo, revalidar.Manejador(cfg.Revalidar))

	// Las tareas que ya son de Go. Cada tanda suma las suyas.
	lista := []tareas.Tarea{{
		// Las reseñas nuevas de Google entran sin publicar; la parte de
		// candidatos a baja de la tarea «semanal» sigue en TS hasta la tanda 3.
		Nombre: "resenas-google", Frecuencia: tareas.Semana, DesdeHora: 6, DesdeDia: time.Monday,
		Ejecutar: func(ctx context.Context) (map[string]any, error) {
			r, err := contenido.Nuevo(pool, nil, log).SincronizarGoogle(ctx, cfg.Google)
			var eg *contenido.ErrGoogle
			if errors.As(err, &eg) {
				return map[string]any{"resenasNuevas": 0, "resenasError": eg.Mensaje}, nil
			}
			if err != nil {
				return nil, err
			}
			return map[string]any{"resenasNuevas": r.Nuevas, "resenasError": nil}, nil
		},
	}, {
		// Avisa cuántos productos son candidatos a baja (no da de baja nada).
		Nombre: "candidatos-baja", Frecuencia: tareas.Semana, DesdeHora: 7, DesdeDia: time.Monday,
		Ejecutar: func(ctx context.Context) (map[string]any, error) {
			s := productos.Nuevo(pool, nil, log)
			meses, err := s.MesesSinVender(ctx)
			if err != nil {
				return nil, err
			}
			c, err := s.Candidatos(ctx, meses, time.Now())
			if err != nil {
				return nil, err
			}
			if n := len(c); n > 0 {
				titulo := strconv.Itoa(n) + " productos para revisar"
				if n == 1 {
					titulo = "1 producto para revisar"
				}
				avisos.Avisar(ctx, push.Aviso{
					Titulo: titulo, Cuerpo: "No se venden, no tienen stock o no tienen precio. Revisá si se dan de baja.",
					URL: "/admin/productos/candidatos", Etiqueta: "candidatos-baja",
				})
			}
			return map[string]any{"candidatosDeBaja": len(c)}, nil
		},
	}}

	// WhatsApp: los payloads del webhook, los estados que llegaron antes que
	// el mensaje y los reintentos de los adjuntos; y la copia diaria de las
	// plantillas de Meta (por si cambió alguna sin que llegara el webhook).
	wa := whatsapp.Nuevo(pool, cfg.WhatsApp, avisos, log)
	wa.Registrar(c)
	lista = append(lista, tareas.Tarea{
		Nombre: "plantillas-whatsapp", Frecuencia: tareas.Dia, DesdeHora: 6,
		Ejecutar: func(ctx context.Context) (map[string]any, error) {
			if wa.Proveedor().ID() != "cloud" {
				return map[string]any{"plantillasWhatsapp": "modo demostración"}, nil
			}
			r, err := wa.SincronizarPlantillas(ctx)
			if err != nil {
				return nil, err
			}
			if r.Error != "" {
				return map[string]any{"plantillasWhatsapp": r.Error}, nil
			}
			return map[string]any{"plantillasWhatsapp": r.Total}, nil
		},
	})

	// Campañas y avisos (tanda 10): las tandas de las campañas, los correos
	// que rebotaron temporalmente (los encola también el despacharEmail del
	// TS), y cada minuto las campañas programadas cuya hora llegó.
	correoT10 := email.Elegir(cfg.Email, log)
	camp := campanas.Nuevo(pool, cfg.Campanas, correoT10, avisos, log)
	c.Registrar(campanas.TipoTanda, camp.ManejadorTanda())
	c.Registrar(avisosT10.TipoReintento, avisosT10.Nuevo(pool, correoT10, cfg.Email.Remitente, log).ManejadorReintento())
	// Los recordatorios de los eventos de mañana (salían de la «diaria» de
	// lib/tareas, a las 7).
	eventos := profesionales.Nuevo(pool, avisosT10.Nuevo(pool, correoT10, cfg.Email.Remitente, log), cfg.Campanas.URLDelSitio(), log)
	lista = append(lista, tareas.Tarea{
		Nombre: "recordatorios-eventos", Frecuencia: tareas.Dia, DesdeHora: 7,
		Ejecutar: func(ctx context.Context) (map[string]any, error) {
			n, err := eventos.EnviarRecordatorios(ctx)
			return map[string]any{"recordatorios": n}, err
		},
	})
	go func() {
		minuto := time.NewTicker(time.Minute)
		defer minuto.Stop()
		for {
			if n, err := camp.IniciarProgramadas(ctx); err != nil {
				log.Error("campañas programadas", "error", err)
			} else if n > 0 {
				log.Info("campañas programadas", "iniciadas", n)
			}
			select {
			case <-ctx.Done():
				return
			case <-minuto.C:
			}
		}
	}()

	// Un trabajo nuevo despierta al worker en el acto (el trigger de
	// `trabajos`); la vuelta de 2 s queda para los reintentos que vencen y
	// por si la escucha se cae.
	urlBase, err := cfg.Base.URLConexion()
	if err != nil {
		return err
	}
	despertar := cola.Despertador(ctx, urlBase, log)

	log.Info("worker andando")
	reloj := time.NewTicker(2 * time.Second)
	defer reloj.Stop()
	ultimaRevision := time.Time{}
	seguir := false
	for {
		if !seguir {
			select {
			case <-ctx.Done():
				log.Info("apagando")
				return nil
			case <-reloj.C:
			case <-despertar:
			}
		} else if ctx.Err() != nil {
			log.Info("apagando")
			return nil
		}
		seguir = false
		// Lo que está a mitad de hacerse termina aunque llegue el SIGTERM:
		// el contexto de la pasada no es el de la señal.
		pasada, cancelar := context.WithTimeout(context.Background(), 5*time.Minute)
		if r, err := c.Procesar(pasada, 100); err != nil {
			log.Error("cola", "error", err)
		} else if n := r.Hechos + r.Reintentos + r.Fallidos; n > 0 {
			log.Info("cola", "hechos", r.Hechos, "reintentos", r.Reintentos, "fallidos", r.Fallidos)
			// Llenó el tope: puede haber más esperando; otra pasada ya.
			seguir = n >= 100
		}
		if time.Since(ultimaRevision) >= time.Minute {
			ultimaRevision = time.Now()
			for _, t := range lista {
				_, _ = tareas.Correr(pasada, q, log, t, time.Now())
			}
		}
		cancelar()
	}
}
