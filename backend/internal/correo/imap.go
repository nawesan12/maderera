package correo

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"mime"
	"net"
	"slices"
	"strings"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
	"github.com/emersion/go-message/charset"
)

// Una conexión IMAP por pedido, y se cierra al terminar.
//
// Para una maderera con unas pocas casillas, abrir y cerrar es más simple y
// más robusto que un pool: no hay conexiones colgadas que el servidor cortó
// por inactividad, ni estado de una carpeta seleccionada que se filtra de un
// pedido a otro. Contra el servidor de correo en la misma red de Docker, la
// conexión con TLS y el login tardan unos pocos milisegundos.

// Servidor es dónde están el IMAP y el SMTP.
type Servidor struct {
	IMAP       string // host:puerto, con TLS directo (993)
	SMTP       string // host
	PuertoSMTP int    // 465 (TLS directo) o 587 (STARTTLS)
	// NombreTLS es el nombre contra el que se verifica el certificado. Dentro
	// de Docker, `mail.<dominio>` es un alias del contenedor del correo, así
	// que la conexión interna también va verificada.
	NombreTLS string
	// CAs es en quién se confía para ese certificado. Nil son las del
	// sistema (Let's Encrypt); solo las pruebas usan una CA propia.
	CAs *x509.CertPool
}

func (s *Servidor) tls() *tls.Config {
	return &tls.Config{ServerName: s.NombreTLS, RootCAs: s.CAs, MinVersion: tls.VersionTLS12}
}

// ErrCredenciales es la casilla o la clave equivocadas.
var ErrCredenciales = errors.New("la casilla o la clave no son correctas")

// ErrNoExiste es una carpeta o un mensaje que no está (lo borraron desde
// otro programa, o la dirección está mal).
var ErrNoExiste = errors.New("no existe")

type conexion struct {
	c *imapclient.Client
}

func (s *Servidor) conectar(ctx context.Context, cred Credenciales) (*conexion, error) {
	opciones := &imapclient.Options{
		TLSConfig:   s.tls(),
		WordDecoder: &mime.WordDecoder{CharsetReader: charset.Reader},
		Dialer:      &net.Dialer{Timeout: 10 * time.Second},
	}
	c, err := imapclient.DialTLS(s.IMAP, opciones)
	if err != nil {
		return nil, fmt.Errorf("conectando al IMAP: %w", err)
	}
	// El contexto corta la conexión: si quien pidió se fue, no tiene sentido
	// seguir bajando un adjunto.
	go func() {
		select {
		case <-ctx.Done():
			_ = c.Close()
		case <-c.Closed():
		}
	}()
	if err := c.Login(cred.Correo, cred.Clave).Wait(); err != nil {
		_ = c.Close()
		var imapErr *imap.Error
		if errors.As(err, &imapErr) && (imapErr.Code == imap.ResponseCodeAuthenticationFailed || imapErr.Type == imap.StatusResponseTypeNo) {
			return nil, ErrCredenciales
		}
		return nil, fmt.Errorf("entrando al IMAP: %w", err)
	}
	return &conexion{c: c}, nil
}

func (cx *conexion) cerrar() {
	_ = cx.c.Logout().Wait()
	_ = cx.c.Close()
}

// Probar entra y sale: es lo que hace el login del webmail.
func (s *Servidor) Probar(ctx context.Context, cred Credenciales) error {
	cx, err := s.conectar(ctx, cred)
	if err != nil {
		return err
	}
	cx.cerrar()
	return nil
}

// Rol es para qué sirve una carpeta, venga del atributo SPECIAL-USE o del
// nombre. Las pantallas muestran el rol traducido y no el nombre de IMAP
// («Junk», «INBOX.Sent»), que no le dice nada a nadie.
type Rol string

const (
	RolEntrada    Rol = "entrada"
	RolEnviados   Rol = "enviados"
	RolBorradores Rol = "borradores"
	RolPapelera   Rol = "papelera"
	RolSpam       Rol = "spam"
	RolArchivo    Rol = "archivo"
	RolOtra       Rol = ""
)

// Carpeta es una carpeta IMAP con sus contadores.
type Carpeta struct {
	Ruta     string `json:"ruta"`
	Nombre   string `json:"nombre"`
	Rol      Rol    `json:"rol,omitempty"`
	Total    uint32 `json:"total"`
	NoLeidos uint32 `json:"noLeidos"`
}

var nombresDeRol = map[Rol]string{
	RolEntrada:    "Entrada",
	RolEnviados:   "Enviados",
	RolBorradores: "Borradores",
	RolPapelera:   "Papelera",
	RolSpam:       "Spam",
	RolArchivo:    "Archivo",
}

// Por si el servidor no marca SPECIAL-USE: los nombres más comunes.
var rolPorNombre = map[string]Rol{
	"sent": RolEnviados, "sent items": RolEnviados, "sent messages": RolEnviados, "enviados": RolEnviados,
	"drafts": RolBorradores, "borradores": RolBorradores,
	"trash": RolPapelera, "deleted items": RolPapelera, "deleted messages": RolPapelera, "papelera": RolPapelera,
	"junk": RolSpam, "spam": RolSpam, "correo no deseado": RolSpam,
	"archive": RolArchivo, "archivo": RolArchivo,
}

func rolDe(datos *imap.ListData) Rol {
	if strings.EqualFold(datos.Mailbox, "INBOX") {
		return RolEntrada
	}
	for _, a := range datos.Attrs {
		switch a {
		case imap.MailboxAttrSent:
			return RolEnviados
		case imap.MailboxAttrDrafts:
			return RolBorradores
		case imap.MailboxAttrTrash:
			return RolPapelera
		case imap.MailboxAttrJunk:
			return RolSpam
		case imap.MailboxAttrArchive:
			return RolArchivo
		}
	}
	hoja := datos.Mailbox
	if datos.Delim != 0 {
		if i := strings.LastIndexByte(hoja, byte(datos.Delim)); i >= 0 {
			hoja = hoja[i+1:]
		}
	}
	return rolPorNombre[strings.ToLower(hoja)]
}

// El orden en que se muestran: primero las de uso diario, después las del
// usuario por nombre.
var ordenDeRol = map[Rol]int{
	RolEntrada: 0, RolBorradores: 1, RolEnviados: 2, RolArchivo: 3, RolSpam: 4, RolPapelera: 5, RolOtra: 6,
}

// Carpetas lista las carpetas con sus contadores.
func (s *Servidor) Carpetas(ctx context.Context, cred Credenciales) ([]Carpeta, error) {
	cx, err := s.conectar(ctx, cred)
	if err != nil {
		return nil, err
	}
	defer cx.cerrar()
	return cx.carpetas()
}

func (cx *conexion) carpetas() ([]Carpeta, error) {
	opciones := &imap.ListOptions{}
	if cx.c.Caps().Has(imap.CapSpecialUse) {
		opciones.ReturnSpecialUse = true
	}
	datos, err := cx.c.List("", "*", opciones).Collect()
	if err != nil {
		return nil, fmt.Errorf("listando carpetas: %w", err)
	}
	var carpetas []Carpeta
	for _, d := range datos {
		if slices.Contains(d.Attrs, imap.MailboxAttrNoSelect) || slices.Contains(d.Attrs, imap.MailboxAttrNonExistent) {
			continue
		}
		rol := rolDe(d)
		nombre := d.Mailbox
		if n, ok := nombresDeRol[rol]; ok {
			nombre = n
		} else if d.Delim != 0 {
			nombre = strings.ReplaceAll(nombre, string(d.Delim), " / ")
		}
		estado, err := cx.c.Status(d.Mailbox, &imap.StatusOptions{NumMessages: true, NumUnseen: true}).Wait()
		if err != nil {
			return nil, fmt.Errorf("contando %q: %w", d.Mailbox, err)
		}
		cp := Carpeta{Ruta: d.Mailbox, Nombre: nombre, Rol: rol}
		if estado.NumMessages != nil {
			cp.Total = *estado.NumMessages
		}
		if estado.NumUnseen != nil {
			cp.NoLeidos = *estado.NumUnseen
		}
		carpetas = append(carpetas, cp)
	}
	slices.SortStableFunc(carpetas, func(a, b Carpeta) int {
		if d := ordenDeRol[a.Rol] - ordenDeRol[b.Rol]; d != 0 {
			return d
		}
		return strings.Compare(strings.ToLower(a.Nombre), strings.ToLower(b.Nombre))
	})
	return carpetas, nil
}

// carpetaDeRol busca la carpeta de un rol; si no existe, la crea con el
// nombre en castellano (el archivo no lo trae docker-mailserver).
func (cx *conexion) carpetaDeRol(rol Rol) (string, error) {
	carpetas, err := cx.carpetas()
	if err != nil {
		return "", err
	}
	for _, c := range carpetas {
		if c.Rol == rol {
			return c.Ruta, nil
		}
	}
	nombre := nombresDeRol[rol]
	if nombre == "" {
		return "", ErrNoExiste
	}
	if err := cx.c.Create(nombre, nil).Wait(); err != nil {
		return "", fmt.Errorf("creando %q: %w", nombre, err)
	}
	return nombre, nil
}

// Direccion es un remitente o destinatario.
type Direccion struct {
	Nombre string `json:"nombre,omitempty"`
	Correo string `json:"correo"`
}

func direcciones(lista []imap.Address) []Direccion {
	out := make([]Direccion, 0, len(lista))
	for _, a := range lista {
		if a.IsGroupStart() || a.IsGroupEnd() {
			continue
		}
		out = append(out, Direccion{Nombre: a.Name, Correo: strings.ToLower(a.Addr())})
	}
	return out
}

// Resumen es una fila de la bandeja.
type Resumen struct {
	UID        uint32      `json:"uid"`
	De         []Direccion `json:"de"`
	Para       []Direccion `json:"para"`
	Asunto     string      `json:"asunto"`
	Fecha      time.Time   `json:"fecha"`
	Leido      bool        `json:"leido"`
	Destacado  bool        `json:"destacado"`
	Respondido bool        `json:"respondido"`
	Adjuntos   bool        `json:"adjuntos"`
	Tamano     int64       `json:"tamano"`
}

// Pagina es una página de la bandeja, de la más nueva a la más vieja.
type Pagina struct {
	Mensajes []Resumen `json:"mensajes"`
	Total    uint32    `json:"total"`
	Pagina   int       `json:"pagina"`
	Paginas  int       `json:"paginas"`
}

const porPagina = 50

var opcionesResumen = &imap.FetchOptions{
	UID:          true,
	Flags:        true,
	Envelope:     true,
	InternalDate: true,
	RFC822Size:   true,
	// Extendida: sin ella el servidor no manda el Content-Disposition, y no
	// se puede saber qué partes son adjuntos.
	BodyStructure: &imap.FetchItemBodyStructure{Extended: true},
}

func resumir(m *imapclient.FetchMessageBuffer) Resumen {
	r := Resumen{UID: uint32(m.UID), Tamano: m.RFC822Size, Fecha: m.InternalDate}
	if e := m.Envelope; e != nil {
		r.De = direcciones(e.From)
		r.Para = direcciones(e.To)
		r.Asunto = e.Subject
		if !e.Date.IsZero() {
			r.Fecha = e.Date
		}
	}
	for _, f := range m.Flags {
		switch f {
		case imap.FlagSeen:
			r.Leido = true
		case imap.FlagFlagged:
			r.Destacado = true
		case imap.FlagAnswered:
			r.Respondido = true
		}
	}
	r.Adjuntos = tieneAdjuntos(m.BodyStructure)
	return r
}

func tieneAdjuntos(bs imap.BodyStructure) bool {
	encontrado := false
	if bs == nil {
		return false
	}
	bs.Walk(func(_ []int, parte imap.BodyStructure) bool {
		if sp, ok := parte.(*imap.BodyStructureSinglePart); ok {
			if d := sp.Disposition(); d != nil && strings.EqualFold(d.Value, "attachment") {
				encontrado = true
			} else if sp.Filename() != "" && !strings.EqualFold(sp.Type, "text") {
				// Hay programas que mandan los adjuntos sin disposición,
				// solo con nombre.
				encontrado = true
			}
		}
		return !encontrado
	})
	return encontrado
}

// Lista devuelve una página de la carpeta, la 1 es la de los más nuevos.
func (s *Servidor) Lista(ctx context.Context, cred Credenciales, carpeta string, pagina int) (*Pagina, error) {
	cx, err := s.conectar(ctx, cred)
	if err != nil {
		return nil, err
	}
	defer cx.cerrar()

	sel, err := cx.c.Select(carpeta, &imap.SelectOptions{ReadOnly: true}).Wait()
	if err != nil {
		return nil, noExisteSi(err)
	}
	total := sel.NumMessages
	paginas := max(1, int((total+porPagina-1)/porPagina))
	pagina = min(max(pagina, 1), paginas)
	out := &Pagina{Total: total, Pagina: pagina, Paginas: paginas, Mensajes: []Resumen{}}
	if total == 0 {
		return out, nil
	}
	// Los números de secuencia van del más viejo (1) al más nuevo (total).
	hasta := int64(total) - int64(pagina-1)*porPagina
	desde := max(1, hasta-porPagina+1)
	var rango imap.SeqSet
	rango.AddRange(uint32(desde), uint32(hasta))
	mensajes, err := cx.c.Fetch(rango, opcionesResumen).Collect()
	if err != nil {
		return nil, fmt.Errorf("trayendo la bandeja: %w", err)
	}
	slices.SortFunc(mensajes, func(a, b *imapclient.FetchMessageBuffer) int { return int(b.SeqNum) - int(a.SeqNum) })
	for _, m := range mensajes {
		out.Mensajes = append(out.Mensajes, resumir(m))
	}
	return out, nil
}

// Buscar busca en remitente, destinatario, asunto y texto. Devuelve los 100
// más nuevos.
func (s *Servidor) Buscar(ctx context.Context, cred Credenciales, carpeta, texto string) ([]Resumen, error) {
	cx, err := s.conectar(ctx, cred)
	if err != nil {
		return nil, err
	}
	defer cx.cerrar()
	if _, err := cx.c.Select(carpeta, &imap.SelectOptions{ReadOnly: true}).Wait(); err != nil {
		return nil, noExisteSi(err)
	}
	criterio := &imap.SearchCriteria{}
	// Cada palabra tiene que aparecer en algún lado: «placas fenólicas juan»
	// encuentra el correo de Juan que habla de placas fenólicas.
	for _, palabra := range strings.Fields(texto) {
		criterio.And(&imap.SearchCriteria{Text: []string{palabra}})
	}
	datos, err := cx.c.UIDSearch(criterio, nil).Wait()
	if err != nil {
		return nil, fmt.Errorf("buscando: %w", err)
	}
	uids := datos.AllUIDs()
	slices.SortFunc(uids, func(a, b imap.UID) int { return int(b) - int(a) })
	if len(uids) > 100 {
		uids = uids[:100]
	}
	if len(uids) == 0 {
		return []Resumen{}, nil
	}
	mensajes, err := cx.c.Fetch(imap.UIDSetNum(uids...), opcionesResumen).Collect()
	if err != nil {
		return nil, fmt.Errorf("trayendo resultados: %w", err)
	}
	slices.SortFunc(mensajes, func(a, b *imapclient.FetchMessageBuffer) int { return int(b.UID) - int(a.UID) })
	out := make([]Resumen, 0, len(mensajes))
	for _, m := range mensajes {
		out = append(out, resumir(m))
	}
	return out, nil
}

// crudo trae el mensaje entero. `marcarLeido` usa BODY[] en vez de
// BODY.PEEK[]: abrir el mensaje lo marca leído, como en cualquier programa.
func (cx *conexion) crudo(carpeta string, uid uint32, marcarLeido bool) ([]byte, []imap.Flag, error) {
	if _, err := cx.c.Select(carpeta, &imap.SelectOptions{ReadOnly: !marcarLeido}).Wait(); err != nil {
		return nil, nil, noExisteSi(err)
	}
	seccion := &imap.FetchItemBodySection{Peek: !marcarLeido}
	mensajes, err := cx.c.Fetch(imap.UIDSetNum(imap.UID(uid)), &imap.FetchOptions{
		UID: true, Flags: true, BodySection: []*imap.FetchItemBodySection{seccion},
	}).Collect()
	if err != nil {
		return nil, nil, fmt.Errorf("trayendo el mensaje: %w", err)
	}
	if len(mensajes) == 0 {
		return nil, nil, ErrNoExiste
	}
	return mensajes[0].FindBodySection(seccion), mensajes[0].Flags, nil
}

// Accion es lo que se puede hacer con un grupo de mensajes.
type Accion string

const (
	AccionLeido      Accion = "leido"
	AccionNoLeido    Accion = "no-leido"
	AccionDestacar   Accion = "destacar"
	AccionNoDestacar Accion = "no-destacar"
	AccionArchivar   Accion = "archivar"
	AccionPapelera   Accion = "papelera"
	AccionSpam       Accion = "spam"
	AccionMover      Accion = "mover"
	// Restaurar devuelve de la papelera o del spam a la entrada.
	AccionRestaurar Accion = "restaurar"
)

// Aplicar hace la acción sobre los mensajes. En la papelera, «papelera»
// borra para siempre: es lo que espera cualquiera que vacía la papelera.
func (s *Servidor) Aplicar(ctx context.Context, cred Credenciales, carpeta string, uids []uint32, accion Accion, destino string) error {
	if len(uids) == 0 {
		return nil
	}
	cx, err := s.conectar(ctx, cred)
	if err != nil {
		return err
	}
	defer cx.cerrar()
	if _, err := cx.c.Select(carpeta, nil).Wait(); err != nil {
		return noExisteSi(err)
	}
	lista := make([]imap.UID, len(uids))
	for i, u := range uids {
		lista[i] = imap.UID(u)
	}
	conjunto := imap.UIDSetNum(lista...)

	marcar := func(op imap.StoreFlagsOp, f imap.Flag) error {
		return cx.c.Store(conjunto, &imap.StoreFlags{Op: op, Silent: true, Flags: []imap.Flag{f}}, nil).Close()
	}
	mover := func(a string) error {
		if a == carpeta {
			return nil
		}
		_, err := cx.c.Move(conjunto, a).Wait()
		return err
	}
	moverARol := func(rol Rol) error {
		a, err := cx.carpetaDeRol(rol)
		if err != nil {
			return err
		}
		// carpetaDeRol listó carpetas: la seleccionada sigue siendo la misma.
		return mover(a)
	}

	switch accion {
	case AccionLeido:
		return marcar(imap.StoreFlagsAdd, imap.FlagSeen)
	case AccionNoLeido:
		return marcar(imap.StoreFlagsDel, imap.FlagSeen)
	case AccionDestacar:
		return marcar(imap.StoreFlagsAdd, imap.FlagFlagged)
	case AccionNoDestacar:
		return marcar(imap.StoreFlagsDel, imap.FlagFlagged)
	case AccionArchivar:
		return moverARol(RolArchivo)
	case AccionSpam:
		return moverARol(RolSpam)
	case AccionRestaurar:
		return mover("INBOX")
	case AccionMover:
		if destino == "" {
			return ErrNoExiste
		}
		return mover(destino)
	case AccionPapelera:
		papelera, err := cx.carpetaDeRol(RolPapelera)
		if err != nil {
			return err
		}
		if papelera != carpeta {
			return mover(papelera)
		}
		if err := marcar(imap.StoreFlagsAdd, imap.FlagDeleted); err != nil {
			return err
		}
		if cx.c.Caps().Has(imap.CapUIDPlus) || cx.c.Caps().Has(imap.CapIMAP4rev2) {
			return cx.c.UIDExpunge(conjunto).Close()
		}
		return cx.c.Expunge().Close()
	}
	return fmt.Errorf("acción desconocida %q", accion)
}

// guardarEnviado deja la copia de lo que se mandó en Enviados, marcada como
// leída. El SMTP no la guarda solo.
func (s *Servidor) guardarEnviado(ctx context.Context, cred Credenciales, crudo []byte) error {
	cx, err := s.conectar(ctx, cred)
	if err != nil {
		return err
	}
	defer cx.cerrar()
	enviados, err := cx.carpetaDeRol(RolEnviados)
	if err != nil {
		return err
	}
	cmd := cx.c.Append(enviados, int64(len(crudo)), &imap.AppendOptions{Flags: []imap.Flag{imap.FlagSeen}, Time: time.Now()})
	if _, err := cmd.Write(crudo); err != nil {
		return err
	}
	if err := cmd.Close(); err != nil {
		return err
	}
	_, err = cmd.Wait()
	return err
}

// marcarRespondido pone la marca de respondido al original.
func (s *Servidor) marcarRespondido(ctx context.Context, cred Credenciales, carpeta string, uid uint32) error {
	cx, err := s.conectar(ctx, cred)
	if err != nil {
		return err
	}
	defer cx.cerrar()
	if _, err := cx.c.Select(carpeta, nil).Wait(); err != nil {
		return noExisteSi(err)
	}
	return cx.c.Store(imap.UIDSetNum(imap.UID(uid)), &imap.StoreFlags{
		Op: imap.StoreFlagsAdd, Silent: true, Flags: []imap.Flag{imap.FlagAnswered},
	}, nil).Close()
}

func noExisteSi(err error) error {
	var imapErr *imap.Error
	if errors.As(err, &imapErr) && imapErr.Type == imap.StatusResponseTypeNo {
		return ErrNoExiste
	}
	return err
}
