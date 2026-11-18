package mostrador

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strconv"
	"strings"
	"time"
)

// La firma de las ventas encoladas sin conexión.
//
// Una venta de la cola dice quién la hizo (`usuarioId`), y al drenarla se
// creía si era alguien real del mostrador: cualquier vendedor con la cola en
// la mano podía subir ventas a nombre de otro. Ahora el servidor le entrega a
// cada sesión del mostrador, en el latido, una firma de su usuario (HMAC con
// una clave derivada del secreto de las sesiones), y la venta encolada la
// lleva. Al drenar, la venta queda a nombre de quien dice solo si la firma es
// de ese usuario y estaba vigente cuando se cobró; si no, queda a nombre de
// quien la sube, como una venta propia.
//
// La firma no puede atar la venta en sí (sin conexión no hay clave con qué
// firmarla): quien copie la firma de otro desde la misma PC puede usarla
// hasta que venza. Por eso vence a los días, y por eso la cola del mismo
// puesto sigue siendo de confianza a medias. Las ventas que ya estaban en la
// cola sin firma no se rechazan: suben a nombre de quien las drena.

// vigenciaDeFirma cubre un corte largo: un fin de semana sin internet.
const vigenciaDeFirma = 7 * 24 * time.Hour

// ConClaveDeCola le da al servicio la clave de las firmas, derivada del
// secreto de las sesiones (BETTER_AUTH_SECRET) para no sumar otra variable.
// Sin clave no se entregan firmas y nadie firma por otro.
func (s *Servicio) ConClaveDeCola(secreto string) *Servicio {
	if secreto == "" {
		s.claveCola = nil
		return s
	}
	m := hmac.New(sha256.New, []byte(secreto))
	m.Write([]byte("mjbj/mostrador/cola/v1"))
	s.claveCola = m.Sum(nil)
	return s
}

func (s *Servicio) mac(usuario string, vence int64) string {
	m := hmac.New(sha256.New, s.claveCola)
	m.Write([]byte("v1|" + usuario + "|" + strconv.FormatInt(vence, 10)))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// FirmaDeCola es la firma que se le entrega a la sesión de usuario: «v1.<vence
// en segundos>.<mac>». Vacía si el servicio no tiene clave.
func (s *Servicio) FirmaDeCola(usuario string, ahora time.Time) (string, time.Time) {
	if len(s.claveCola) == 0 {
		return "", time.Time{}
	}
	vence := ahora.Add(vigenciaDeFirma).Truncate(time.Second)
	return "v1." + strconv.FormatInt(vence.Unix(), 10) + "." + s.mac(usuario, vence.Unix()), vence
}

// FirmaValida: la firma es de usuario y la venta se cobró mientras estaba
// vigente (sin la hora de cobro, se mira contra ahora).
func (s *Servicio) FirmaValida(firma, usuario string, cobrada *time.Time) bool {
	if len(s.claveCola) == 0 || firma == "" {
		return false
	}
	partes := strings.Split(firma, ".")
	if len(partes) != 3 || partes[0] != "v1" {
		return false
	}
	vence, err := strconv.ParseInt(partes[1], 10, 64)
	if err != nil {
		return false
	}
	if !hmac.Equal([]byte(partes[2]), []byte(s.mac(usuario, vence))) {
		return false
	}
	cuando := s.ahora()
	if cobrada != nil {
		cuando = *cobrada
	}
	hasta := time.Unix(vence, 0)
	// Ni después de vencida ni antes de que se entregara.
	return !cuando.After(hasta) && !cuando.Before(hasta.Add(-vigenciaDeFirma-time.Hour))
}
