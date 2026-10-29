package facturacion

import (
	"context"
	"math"
	"time"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/fiscal"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
	"mjbj/internal/sqlc"
)

// Lo tributario de /admin/arca: los datos del emisor, los puntos de venta y
// el estado de la conexión con ARCA.

var regimenes = []string{"local", "convenio_multilateral", "exento", "no_inscripto"}

// opcional es el `?? null` de un campo opcional ya recortado.
func opcional(t string, esta bool) *string {
	if !esta {
		return nil
	}
	return &t
}

// datosEmisor es lo que dejaba el esquema de zod del emisor.
type datosEmisor struct {
	razon, cuit, condicion, localidad, regimen     string
	fantasia, domicilio, cp, tel, email, iibb, ley *string
	alicuota                                       float64
	percibe                                        bool
	inicio                                         *time.Time
}

// validarEmisor es el esquema de guardarDatosEmisor.
func validarEmisor(c map[string]string) (datosEmisor, error) {
	var e esquema
	var d datosEmisor
	d.razon, _ = e.cadena("razonSocial", get(c, "razonSocial"), false, 2, "Falta la razón social.", 160)
	d.fantasia = opcional(e.cadena("nombreFantasia", vacioAUndef(c, "nombreFantasia"), true, 0, "", 160))
	cuit, _ := e.cadena("cuit", get(c, "cuit"), false, 0, "", 0)
	if e.ok() && !cuitZod.MatchString(cuit) {
		e.mal("cuit", "El CUIT tiene que tener 11 dígitos.")
	}
	d.cuit = fiscal.SoloDigitos(cuit)
	d.condicion = e.opcion("condicionIva", get(c, "condicionIva"), fiscal.Condiciones)
	d.domicilio = opcional(e.cadena("domicilio", vacioAUndef(c, "domicilio"), true, 0, "", 200))
	d.localidad, _ = e.cadena("localidad", vacioAUndef(c, "localidad"), true, 0, "", 80)
	d.cp = opcional(e.cadena("codigoPostal", vacioAUndef(c, "codigoPostal"), true, 0, "", 12))
	d.tel = opcional(e.cadena("telefono", vacioAUndef(c, "telefono"), true, 0, "", 40))
	d.email = opcional(e.cadena("email", vacioAUndef(c, "email"), true, 0, "", 120))
	d.iibb = opcional(e.cadena("ingresosBrutos", vacioAUndef(c, "ingresosBrutos"), true, 0, "", 40))
	reg := get(c, "regimenIibb")
	if reg.nulo || reg.s == "" {
		reg = texto("local")
	}
	d.regimen = e.opcion("regimenIibb", reg, regimenes)
	alicTexto, hayAlic := e.cadena("alicuotaPercepcionIibb", vacioAUndef(c, "alicuotaPercepcionIibb"), true, 0, "", 0)
	inicio, hayInicio := e.cadena("inicioActividades", vacioAUndef(c, "inicioActividades"), true, 0, "", 0)
	d.ley = opcional(e.cadena("leyenda", vacioAUndef(c, "leyenda"), true, 0, "", 500))
	if err := e.Problema(); err != nil {
		return d, err
	}
	d.percibe = c["percibeIibb"] == "on"
	if !hayAlic {
		alicTexto = "0"
	}
	d.alicuota = precios.ParsearImporte(alicTexto)
	if math.IsNaN(d.alicuota) || math.IsInf(d.alicuota, 0) {
		d.alicuota = 0
	}
	if hayInicio && inicio != "" {
		t, err := time.Parse("2006-01-02", inicio)
		if err != nil {
			if t, err = time.Parse(time.RFC3339Nano, inicio); err != nil {
				// new Date(texto) inválido hacía tirar al guardar (un 500).
				return d, plataforma.Invalido(map[string]string{"inicioActividades": "Revisá la fecha de inicio de actividades."})
			}
		}
		d.inicio = &t
	}
	if d.localidad == "" {
		d.localidad = "Mar del Plata"
	}
	return d, nil
}

// GuardarEmisor es guardarDatosEmisor (solo el admin).
func (s *Servicio) GuardarEmisor(ctx context.Context, ses *auth.Sesion, c map[string]string) (string, error) {
	d, err := validarEmisor(c)
	if err != nil {
		return "", err
	}
	emisor, err := s.ObtenerEmisor(ctx)
	if err != nil {
		return "", err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE configuracion_fiscal SET razon_social = $2, nombre_fantasia = $3, cuit = $4,
		condicion_iva = $5::condicion_iva, domicilio = $6, localidad = $7, codigo_postal = $8, telefono = $9, email = $10,
		ingresos_brutos = $11, regimen_iibb = $12::regimen_iibb, alicuota_percepcion_iibb = $13::numeric, percibe_iibb = $14,
		inicio_actividades = $15, leyenda = $16, updated_at = now() WHERE id = $1`,
		emisor.ID, d.razon, d.fantasia, d.cuit, d.condicion, d.domicilio, d.localidad, d.cp, d.tel, d.email, d.iibb, d.regimen,
		jsmath.ToFixed(d.alicuota, 2), d.percibe, d.inicio, d.ley); err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "configuracion", "", "Cambió los datos fiscales del emisor", nil)
	return "Datos guardados.", nil
}

// PuntoDeVenta es un punto de venta habilitado en ARCA.
type PuntoDeVenta struct {
	ID            string  `json:"id"`
	Numero        int64   `json:"numero"`
	Nombre        string  `json:"nombre"`
	Modalidad     string  `json:"modalidad"`
	Activo        bool    `json:"activo"`
	NumeroInicial int64   `json:"numeroInicial"`
	BranchID      *string `json:"branchId"`
	Sucursal      *string `json:"sucursal"`
}

// PuntosDeVenta es listarPuntosVenta, por número.
func (s *Servicio) PuntosDeVenta(ctx context.Context) ([]PuntoDeVenta, error) {
	filas, err := s.pool.Query(ctx, `SELECT p.id, p.numero, p.nombre, p.modalidad, p.activo, p.numero_inicial, p.branch_id, b.name
		FROM puntos_venta p LEFT JOIN branches b ON b.id = p.branch_id ORDER BY p.numero`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []PuntoDeVenta{}
	for filas.Next() {
		var p PuntoDeVenta
		if err := filas.Scan(&p.ID, &p.Numero, &p.Nombre, &p.Modalidad, &p.Activo, &p.NumeroInicial, &p.BranchID, &p.Sucursal); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, filas.Err()
}

// datosPunto es lo que dejaba el esquema del punto de venta.
type datosPunto struct {
	id, sucursal    string
	numero, inicial float64
	nombre          string
	activo          bool
}

func validarPunto(c map[string]string) (datosPunto, error) {
	var e esquema
	var d datosPunto
	d.id = e.uuid("id", vacioAUndef(c, "id"), true)
	d.numero = e.entero("numero", get(c, "numero"), 1, 99999)
	d.nombre, _ = e.cadena("nombre", get(c, "nombre"), false, 2, "Poné un nombre.", 80)
	d.sucursal = e.uuid("branchId", vacioAUndef(c, "branchId"), true)
	d.activo = c["activo"] != "off"
	ini := vacioAUndef(c, "numeroInicial")
	if ini.nada {
		ini = texto("0")
	}
	d.inicial = e.entero("numeroInicial", ini, 0, 99_999_999)
	return d, e.Problema()
}

// GuardarPuntoDeVenta es guardarPuntoVenta (solo el admin): alta o edición.
func (s *Servicio) GuardarPuntoDeVenta(ctx context.Context, ses *auth.Sesion, c map[string]string) (string, error) {
	d, err := validarPunto(c)
	if err != nil {
		return "", err
	}
	id, numero, nombre, sucursal, activo, inicial := d.id, d.numero, d.nombre, d.sucursal, d.activo, d.inicial
	var branch *string
	if sucursal != "" {
		branch = &sucursal
	}
	if id != "" {
		_, err = s.pool.Exec(ctx, `UPDATE puntos_venta SET numero = $2, nombre = $3, branch_id = $4, activo = $5, numero_inicial = $6 WHERE id = $1`,
			id, int64(numero), nombre, branch, activo, int64(inicial))
	} else {
		_, err = s.pool.Exec(ctx, `INSERT INTO puntos_venta (numero, nombre, branch_id, activo, numero_inicial) VALUES ($1, $2, $3, $4, $5)`,
			int64(numero), nombre, branch, activo, int64(inicial))
	}
	if err != nil {
		if ctx.Err() != nil {
			return "", err
		}
		return "", plataforma.Invalido(map[string]string{"numero": "Ya hay un punto de venta con el número " + jsmath.Texto(numero) + "."})
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "configuracion", "", "Cambió un punto de venta", nil)
	return "Punto de venta guardado.", nil
}

// EstadoArca es EstadoProveedorFiscal más lo que la pantalla de ARCA
// preguntaba por separado (qué credencial falta).
type EstadoArca struct {
	ID             string  `json:"id"` // arca | interno
	Operativo      bool    `json:"operativo"`
	Ambiente       *string `json:"ambiente"`
	Cuit           *string `json:"cuit"`
	Detalle        *string `json:"detalle"`
	ServicioArriba *bool   `json:"servicioArriba"`
	HayCertificado bool    `json:"hayCertificado"`
	HayClave       bool    `json:"hayClave"`
}

func cad(s string) *string { return &s }

// Estado pregunta a ARCA si está en pie (FEDummy, sin ticket).
func (s *Servicio) Estado(ctx context.Context) EstadoArca {
	e := EstadoArca{HayCertificado: s.env.HayCertificado(), HayClave: s.env.HayClave()}
	if !s.env.UsaArca() {
		e.ID = "interno"
		e.Detalle = cad("Los comprobantes se numeran y se imprimen, pero no se envían a ARCA: falta el certificado digital.")
		return e
	}
	cfg := s.env.Leer()
	e.ID, e.Ambiente, e.Cuit = "arca", &cfg.Ambiente, &cfg.Cuit
	arriba := false
	if body, err := fiscal.Llamar(ctx, cfg, s.bitacoraArca(), "FEDummy", "", nil); err == nil {
		arriba = fiscal.LeerDummy(body)
	}
	e.ServicioArriba = &arriba
	e.Operativo = arriba
	switch {
	case !arriba:
		e.Detalle = cad("Los servicios de ARCA no están respondiendo en este momento.")
	case cfg.Ambiente == "homologacion":
		e.Detalle = cad("Conectado al ambiente de homologación: los comprobantes son de prueba y no tienen valor fiscal.")
	}
	return e
}
