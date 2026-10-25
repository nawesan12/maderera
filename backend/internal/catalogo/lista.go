// Package catalogo es el catálogo público: categorías, productos, fichas,
// precios por lista, sugeridos y la portada. Es lib/dal/catalog.ts y
// lib/dal/precios-sesion.ts, con **las mismas formas de respuesta** (los
// mismos nombres de campo, los precios como texto) para que las páginas de
// Next no cambien: sus funciones de lib/dal pasan a ser llamadas a esta API.
package catalogo

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/jsmath"
	"mjbj/internal/sqlc"
)

// Servicio lee el catálogo.
type Servicio struct {
	pool *pgxpool.Pool
	q    *sqlc.Queries
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool) *Servicio { return &Servicio{pool: pool, q: sqlc.New(pool)} }

// Lista es qué lista de precios se aplica (ListaVigente del TS).
type Lista struct {
	ID             *string `json:"id"`
	GeneralID      *string `json:"generalId"`
	Nombre         *string `json:"nombre"`
	EsDiferenciada bool    `json:"esDiferenciada"`
	FactorDerivado float64 `json:"factorDerivado"`
}

// FactorDeLista es factorDeLista (lib/precios/derivada.ts): el multiplicador
// de una lista «general −N %», acotado a la mitad y el doble para que un cero
// de más no publique el catálogo al 10 %.
func FactorDeLista(porcentaje *jsmath.Num) float64 {
	if porcentaje == nil {
		return 1
	}
	pct := float64(*porcentaje)
	if pct == 0 {
		return 1
	}
	return min(max(1+pct/100, 0.5), 2)
}

// General es la lista general: la misma para todos, la pública.
func (s *Servicio) General(ctx context.Context) (Lista, error) {
	g, err := s.q.ListaGeneral(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return Lista{FactorDerivado: 1}, nil
	}
	if err != nil {
		return Lista{}, err
	}
	return Lista{ID: &g.ID, GeneralID: &g.ID, Nombre: &g.Name, FactorDerivado: 1}, nil
}

// Vigente es la lista de quien mira (listaVigente del TS), en este orden: la
// del perfil, la de la ficha de cliente, la general. **Nunca se cachea entre
// personas**: un precio mayorista servido al público es el peor error posible
// de este módulo.
func (s *Servicio) Vigente(ctx context.Context, ses *auth.Sesion) (Lista, error) {
	general, err := s.General(ctx)
	if err != nil || ses == nil {
		return general, err
	}
	elegida := ses.ListaPrecio
	if elegida == nil {
		ficha, err := s.q.ListaDeLaFicha(ctx, &ses.UserID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return Lista{}, err
		}
		elegida = ficha
	}
	if elegida == nil || (general.ID != nil && *elegida == *general.ID) {
		return general, nil
	}
	propia, err := s.q.ListaPorID(ctx, *elegida)
	if errors.Is(err, pgx.ErrNoRows) {
		return general, nil
	}
	if err != nil {
		return Lista{}, err
	}
	return Lista{
		ID: &propia.ID, GeneralID: general.ID, Nombre: &propia.Name,
		EsDiferenciada: true, FactorDerivado: FactorDeLista(propia.PorcentajeSobreGeneral),
	}, nil
}

// Vista es cómo se muestra el precio: "final" (con IVA, lo que se paga) o
// "neto" (para el responsable inscripto y las listas diferenciadas). Los
// precios guardados no cambian: siguen siendo finales.
func (s *Servicio) Vista(ctx context.Context, ses *auth.Sesion, lista Lista) (string, error) {
	if ses == nil {
		return "final", nil
	}
	if lista.EsDiferenciada {
		return "neto", nil
	}
	if c, err := s.q.CondicionIvaDelPerfil(ctx, ses.UserID); err == nil && c == sqlc.CondicionIvaResponsableInscripto {
		return "neto", nil
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	c, err := s.q.CondicionIvaDeLaFicha(ctx, &ses.UserID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if err == nil && c == sqlc.CondicionIvaResponsableInscripto {
		return "neto", nil
	}
	return "final", nil
}
