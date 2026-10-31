package correo

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"
)

// La sesión del webmail vive en una cookie sellada (AES-GCM), no en la base.
//
// El correo tiene que poder leerse aunque la base del ERP esté caída o en
// mantenimiento, y el servidor de correo ya es el que sabe si una clave es
// buena: lo único que hace falta guardar entre pedidos es la casilla y su
// clave, para volver a entrar por IMAP. Sellada con una clave que solo tiene
// este servicio, la cookie no se puede leer ni fabricar; si alguien se la
// roba, vale hasta que vence, igual que la sesión de cualquier webmail.
//
// **Dos vencimientos.** Una sesión dura como máximo `duracionMaxima`, y se
// corta antes si pasa `inactividadMaxima` sin uso: es la PC del mostrador, y
// alguien se puede ir sin cerrar.
const (
	duracionMaxima    = 12 * time.Hour
	inactividadMaxima = 2 * time.Hour
	// Cada cuánto se renueva la marca de uso: renovarla en cada pedido
	// reescribiría la cookie en cada carga de la bandeja sin necesidad.
	renovarCada = 5 * time.Minute
)

// Credenciales son la casilla y la clave con que se entra por IMAP y SMTP.
type Credenciales struct {
	Correo string `json:"c"`
	Clave  string `json:"k"`
}

type contenidoSesion struct {
	Credenciales
	Creada int64 `json:"i"`
	Usada  int64 `json:"u"`
}

// Sellador sella y abre las cookies de sesión.
type Sellador struct {
	aead   cipher.AEAD
	nombre string
	segura bool
	ahora  func() time.Time
}

// NuevoSellador recibe la clave de 32 bytes (AES-256). `segura` es falso solo
// en desarrollo, sin HTTPS: el prefijo `__Host-` exige `Secure`.
func NuevoSellador(clave []byte, segura bool) (*Sellador, error) {
	if len(clave) != 32 {
		return nil, errors.New("CORREO_CLAVE tiene que ser de 32 bytes en base64 (openssl rand -base64 32)")
	}
	bloque, err := aes.NewCipher(clave)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(bloque)
	if err != nil {
		return nil, err
	}
	nombre := "correo_sesion"
	if segura {
		// `__Host-`: solo HTTPS, sin `Domain`, ruta `/`. Ningún otro
		// subdominio de mjbj.com.ar la puede pisar.
		nombre = "__Host-correo_sesion"
	}
	return &Sellador{aead: aead, nombre: nombre, segura: segura, ahora: time.Now}, nil
}

func (s *Sellador) sellar(c contenidoSesion) (string, error) {
	plano, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	// El nombre de la cookie va como dato asociado: una cookie sellada para
	// otro uso no se puede pasar por esta.
	sellado := s.aead.Seal(nonce, nonce, plano, []byte(s.nombre))
	return base64.RawURLEncoding.EncodeToString(sellado), nil
}

func (s *Sellador) abrir(valor string) (contenidoSesion, error) {
	var c contenidoSesion
	crudo, err := base64.RawURLEncoding.DecodeString(valor)
	if err != nil || len(crudo) < s.aead.NonceSize() {
		return c, errSinSesion
	}
	nonce, cifrado := crudo[:s.aead.NonceSize()], crudo[s.aead.NonceSize():]
	plano, err := s.aead.Open(nil, nonce, cifrado, []byte(s.nombre))
	if err != nil {
		return c, errSinSesion
	}
	if err := json.Unmarshal(plano, &c); err != nil {
		return c, errSinSesion
	}
	return c, nil
}

var errSinSesion = errors.New("sin sesión")

// Iniciar escribe la cookie de una sesión nueva.
func (s *Sellador) Iniciar(w http.ResponseWriter, cred Credenciales) error {
	ahora := s.ahora().Unix()
	return s.escribir(w, contenidoSesion{Credenciales: cred, Creada: ahora, Usada: ahora})
}

func (s *Sellador) escribir(w http.ResponseWriter, c contenidoSesion) error {
	valor, err := s.sellar(c)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     s.nombre,
		Value:    valor,
		Path:     "/",
		Expires:  time.Unix(c.Creada, 0).Add(duracionMaxima),
		HttpOnly: true,
		Secure:   s.segura,
		SameSite: http.SameSiteStrictMode,
	})
	return nil
}

// Leer devuelve las credenciales de la sesión vigente, y de paso renueva la
// marca de uso si hace falta.
func (s *Sellador) Leer(w http.ResponseWriter, r *http.Request) (Credenciales, error) {
	ck, err := r.Cookie(s.nombre)
	if err != nil {
		return Credenciales{}, errSinSesion
	}
	c, err := s.abrir(ck.Value)
	if err != nil {
		return Credenciales{}, err
	}
	ahora := s.ahora()
	if ahora.Sub(time.Unix(c.Creada, 0)) > duracionMaxima || ahora.Sub(time.Unix(c.Usada, 0)) > inactividadMaxima {
		s.Cerrar(w)
		return Credenciales{}, errSinSesion
	}
	if ahora.Sub(time.Unix(c.Usada, 0)) > renovarCada {
		c.Usada = ahora.Unix()
		_ = s.escribir(w, c)
	}
	return c.Credenciales, nil
}

// Cerrar borra la cookie.
func (s *Sellador) Cerrar(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     s.nombre,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.segura,
		SameSite: http.SameSiteStrictMode,
	})
}

// Intentos cuenta los intentos fallidos de entrar, por IP y por casilla.
//
// El fail2ban del servidor de correo no sirve para el webmail: ve todas las
// entradas como venidas de este contenedor, y bloquearlo dejaría afuera a
// todos a la vez. Por eso el límite va acá, con la IP real.
type Intentos struct {
	mu      sync.Mutex
	fallos  map[string][]time.Time
	tope    int
	ventana time.Duration
	ahora   func() time.Time
}

// NuevosIntentos: `tope` fallos dentro de `ventana` bloquean hasta que el más
// viejo salga de la ventana.
func NuevosIntentos(tope int, ventana time.Duration) *Intentos {
	return &Intentos{fallos: map[string][]time.Time{}, tope: tope, ventana: ventana, ahora: time.Now}
}

func (in *Intentos) vigentes(clave string, ahora time.Time) []time.Time {
	lista := in.fallos[clave]
	i := 0
	for i < len(lista) && ahora.Sub(lista[i]) > in.ventana {
		i++
	}
	lista = lista[i:]
	if len(lista) == 0 {
		delete(in.fallos, clave)
	} else {
		in.fallos[clave] = lista
	}
	return lista
}

// Permitido dice si todas las claves (la IP, la casilla) están bajo el tope.
func (in *Intentos) Permitido(claves ...string) bool {
	in.mu.Lock()
	defer in.mu.Unlock()
	ahora := in.ahora()
	for _, c := range claves {
		if len(in.vigentes(c, ahora)) >= in.tope {
			return false
		}
	}
	return true
}

// Fallo anota un intento fallido en cada clave.
func (in *Intentos) Fallo(claves ...string) {
	in.mu.Lock()
	defer in.mu.Unlock()
	ahora := in.ahora()
	for _, c := range claves {
		in.fallos[c] = append(in.vigentes(c, ahora), ahora)
	}
}

// Limpiar borra los fallos de una clave (después de una entrada buena).
func (in *Intentos) Limpiar(clave string) {
	in.mu.Lock()
	defer in.mu.Unlock()
	delete(in.fallos, clave)
}
