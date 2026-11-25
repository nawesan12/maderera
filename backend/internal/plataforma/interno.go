package plataforma

import (
	"crypto/subtle"
	"net/http"
)

// ConfigInterna es el secreto que comparte Next con la API para lo que solo
// puede pedir otro servidor: los precios de una lista dada sin la cookie de
// quien la tiene, para guardarlos en la caché de Next (la clave es la lista,
// no la persona).
type ConfigInterna struct {
	Secreto string `env:"API_SECRETO_INTERNO"`
}

// EsInterno: el pedido trae `Authorization: Bearer <secreto>`. Sin secreto
// configurado, nunca.
func (c ConfigInterna) EsInterno(r *http.Request) bool {
	if c.Secreto == "" || r == nil {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+c.Secreto)) == 1
}
