package facturacion

import (
	"context"

	"mjbj/internal/fiscal"
	"mjbj/internal/reglas"
)

// letraPara es la letra que corresponde con la regla del negocio
// factura_al_monotributista (H207). La leen la emisión, el aviso de la letra
// en el mostrador y la corrección de un rechazado: los tres dicen lo mismo.
func letraPara(ctx context.Context, c reglas.Consultador, emisor, receptor string) (string, error) {
	regla, err := reglas.Valor(ctx, c, reglas.FacturaAlMonotributista)
	if err != nil {
		return "", err
	}
	return fiscal.LetraConRegla(emisor, receptor, regla), nil
}
