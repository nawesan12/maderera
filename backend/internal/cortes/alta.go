package cortes

// El alta de un corte, los formatos para la máquina, las tarifas y los
// parámetros de las calculadoras (las acciones de app/admin/cortes y
// app/admin/calculadoras).

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
	"mjbj/internal/sqlc"
)

// FormCorte es el formulario del alta, con los campos como llegan del
// navegador (texto; vacío es «no vino»). Cada pieza es el JSON que arma la
// pantalla.
type FormCorte struct {
	CustomerID          string            `json:"customerId"`
	OrderID             string            `json:"orderId"`
	ContactoNombre      string            `json:"contactoNombre"`
	BranchID            string            `json:"branchId"`
	VariantID           string            `json:"variantId"`
	MaterialDescripcion string            `json:"materialDescripcion"`
	PlacaLargoMm        string            `json:"placaLargoMm"`
	PlacaAnchoMm        string            `json:"placaAnchoMm"`
	Mitad               string            `json:"mitad"`
	Placas              string            `json:"placas"`
	CantoDescripcion    string            `json:"cantoDescripcion"`
	Urgente             bool              `json:"urgente"`
	Notas               string            `json:"notas"`
	AcomodoManual       string            `json:"acomodoManual"`
	AnchoSierraMm       string            `json:"anchoSierraMm"`
	Piezas              []json.RawMessage `json:"piezas"`
}

type piezaNueva struct {
	largo, ancho, cantidad, cantoLargo, cantoAncho int32
	veta                                           int32
	aclaracion, etiqueta                           *string
}

func opcional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// validarPieza es el esquema `pieza` del alta: cualquier problema es el mismo
// aviso.
func validarPieza(crudo json.RawMessage) (piezaNueva, bool) {
	var m map[string]any
	if json.Unmarshal(crudo, &m) != nil || m == nil {
		return piezaNueva{}, false
	}
	num := func(clave string, r reglaNumero, def *float64) (int32, bool) {
		v, presente := m[clave]
		if !presente && def != nil {
			return int32(*def), true
		}
		n := numeroJS(v, presente)
		if validarNumero(n, r) != "" {
			return 0, false
		}
		return int32(n), true
	}
	var p piezaNueva
	var ok bool
	medida := reglaNumero{entero: true, positivo: true, max: pf(10_000)}
	if p.largo, ok = num("largoMm", medida, nil); !ok {
		return p, false
	}
	if p.ancho, ok = num("anchoMm", medida, nil); !ok {
		return p, false
	}
	if p.cantidad, ok = num("cantidad", reglaNumero{entero: true, positivo: true, max: pf(999)}, nil); !ok {
		return p, false
	}
	switch v := m["respetaVeta"].(type) {
	case nil:
		if _, presente := m["respetaVeta"]; presente {
			return p, false
		}
	case bool:
		if v {
			p.veta = 1
		}
	default:
		return p, false
	}
	canto := reglaNumero{entero: true, min: pf(0), max: pf(2)}
	if p.cantoLargo, ok = num("cantoLargo", canto, pf(0)); !ok {
		return p, false
	}
	if p.cantoAncho, ok = num("cantoAncho", canto, pf(0)); !ok {
		return p, false
	}
	texto := func(clave string, max int) (*string, bool) {
		v, presente := m[clave]
		if !presente {
			return nil, true
		}
		s, es := v.(string)
		if !es {
			return nil, false
		}
		t, msg := validarTexto(s, 0, "", max)
		return &t, msg == ""
	}
	if p.aclaracion, ok = texto("aclaracion", 120); !ok {
		return p, false
	}
	if p.etiqueta, ok = texto("etiqueta", 80); !ok {
		return p, false
	}
	return p, true
}

// Crear da de alta una orden de corte (crearCorte). Devuelve el número.
func (s *Servicio) Crear(ctx context.Context, ses *auth.Sesion, f FormCorte) (string, error) {
	// La cabecera, en el orden de las claves del esquema: el primer error es
	// el que se muestra.
	uuidOpcional := func(v string) string {
		if v != "" && !plataforma.UUIDValido(v) {
			return "Invalid UUID"
		}
		return ""
	}
	medida := func(v string) (*int32, string) {
		if v == "" {
			return nil, ""
		}
		n := jsmath.Numero(v)
		if msg := validarNumero(n, reglaNumero{entero: true, positivo: true, max: pf(6000)}); msg != "" {
			return nil, msg
		}
		x := int32(n)
		return &x, ""
	}
	contacto, msgContacto := validarTexto(f.ContactoNombre, 2, "Poné para quién es.", 160)
	material, msgMaterial := validarTexto(f.MaterialDescripcion, 2, "Falta decir qué placa se corta.", 200)
	largo, msgLargo := medida(f.PlacaLargoMm)
	ancho, msgAncho := medida(f.PlacaAnchoMm)
	msgMitad := ""
	if f.Mitad != "" && f.Mitad != "largo" && f.Mitad != "ancho" {
		msgMitad = `Invalid option: expected one of "largo"|"ancho"`
	}
	placasTxt := f.Placas
	if placasTxt == "" {
		placasTxt = "1"
	}
	placasN := jsmath.Numero(placasTxt)
	msgPlacas := validarNumero(placasN, reglaNumero{entero: true, positivo: true, max: pf(999)})
	var canto, notas *string
	msgCanto, msgNotas, msgAcomodo := "", "", ""
	if f.CantoDescripcion != "" {
		t, m := validarTexto(f.CantoDescripcion, 0, "", 120)
		canto, msgCanto = &t, m
	}
	if f.Notas != "" {
		t, m := validarTexto(f.Notas, 0, "", 1000)
		notas, msgNotas = &t, m
	}
	if largoJS(f.AcomodoManual) > 20_000 {
		msgAcomodo = "Too big: expected string to have <=20000 characters"
	}
	for _, msg := range []string{
		uuidOpcional(f.CustomerID), uuidOpcional(f.OrderID), msgContacto, uuidOpcional(f.BranchID),
		uuidOpcional(f.VariantID), msgMaterial, msgLargo, msgAncho, msgMitad, msgPlacas, msgCanto, msgNotas, msgAcomodo,
	} {
		if msg != "" {
			return "", error422(msg)
		}
	}

	piezas := make([]piezaNueva, 0, len(f.Piezas))
	for _, cruda := range f.Piezas {
		p, ok := validarPieza(cruda)
		if !ok {
			return "", error422("Hay una pieza con medidas incompletas.")
		}
		piezas = append(piezas, p)
	}
	if len(piezas) == 0 {
		return "", error422("Agregá al menos una pieza al despiece.")
	}

	sierra := LeerAnchoDeSierra(f.AnchoSierraMm)
	if sierra == nil {
		p, err := s.Parametros(ctx)
		if err != nil {
			return "", err
		}
		sierra = &p.AnchoSierraMm
	}

	var numero string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		if numero, err = numeracion.Corte(ctx, tx); err != nil {
			return err
		}
		branch := opcional(f.BranchID)
		if branch == nil {
			if err := tx.QueryRow(ctx, `SELECT id::text FROM branches WHERE active ORDER BY sort_order LIMIT 1`).Scan(&branch); err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
		urgente := 0
		if f.Urgente {
			urgente = 1
		}
		var id string
		if err := tx.QueryRow(ctx, `
			INSERT INTO cutting_orders (numero, customer_id, order_id, contacto_nombre, branch_id, variant_id,
				material_descripcion, placa_largo_mm, placa_ancho_mm, mitad, placas, canto_descripcion,
				acomodo_manual, ancho_sierra_mm, estado, urgente, notas, created_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::mitad_placa, $11, $12, $13, $14, 'en-cola', $15, $16, $17)
			RETURNING id::text`,
			numero, opcional(f.CustomerID), opcional(f.OrderID), contacto, branch, opcional(f.VariantID), material,
			largo, ancho, opcional(f.Mitad), int32(placasN), canto, opcional(f.AcomodoManual), jsmath.Num(*sierra),
			urgente, notas, ses.UserID).Scan(&id); err != nil {
			return err
		}
		for orden, p := range piezas {
			if _, err := tx.Exec(ctx, `
				INSERT INTO cutting_items (cutting_order_id, largo_mm, ancho_mm, cantidad, respeta_veta, canto_largo,
					canto_ancho, aclaracion, etiqueta, orden)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
				id, p.largo, p.ancho, p.cantidad, p.veta, p.cantoLargo, p.cantoAncho, p.aclaracion, p.etiqueta, orden); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "corte", numero,
		"Cargó el corte "+numero+" para "+contacto, nil)
	return numero, nil
}

// --- los formatos para la máquina ---

// Perfil es una fila de cutting_export_profiles, para la pantalla.
type Perfil struct {
	ID            string    `json:"id"`
	Nombre        string    `json:"nombre"`
	Programa      *string   `json:"programa"`
	Separador     string    `json:"separador"`
	ConEncabezado bool      `json:"conEncabezado"`
	Unidad        string    `json:"unidad"`
	Decimal       string    `json:"decimal"`
	ValorSi       string    `json:"valorSi"`
	ValorNo       string    `json:"valorNo"`
	FinDeLinea    string    `json:"finDeLinea"`
	Columnas      string    `json:"columnas"`
	PorDefecto    bool      `json:"porDefecto"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

const columnasDePerfil = `id::text, nombre, programa, separador, con_encabezado, unidad, decimal, valor_si, valor_no,
	fin_de_linea, columnas, por_defecto, created_at, updated_at`

func leerPerfil(r pgx.Row) (Perfil, error) {
	var p Perfil
	err := r.Scan(&p.ID, &p.Nombre, &p.Programa, &p.Separador, &p.ConEncabezado, &p.Unidad, &p.Decimal, &p.ValorSi,
		&p.ValorNo, &p.FinDeLinea, &p.Columnas, &p.PorDefecto, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}

// Perfiles son los formatos guardados, el de por defecto primero.
func (s *Servicio) Perfiles(ctx context.Context) ([]Perfil, error) {
	filas, err := s.pool.Query(ctx, `SELECT `+columnasDePerfil+` FROM cutting_export_profiles ORDER BY por_defecto DESC, nombre ASC`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Perfil, error) { return leerPerfil(r) })
}

// PerfilParaExportar es el pedido, o el de por defecto, o el genérico.
func (s *Servicio) PerfilParaExportar(ctx context.Context, id string) (PerfilDeExportacion, error) {
	var fila pgx.Row
	if id != "" {
		if !plataforma.UUIDValido(id) {
			return PerfilGenerico(), nil
		}
		fila = s.pool.QueryRow(ctx, `SELECT `+columnasDePerfil+` FROM cutting_export_profiles WHERE id = $1 LIMIT 1`, id)
	} else {
		fila = s.pool.QueryRow(ctx, `SELECT `+columnasDePerfil+` FROM cutting_export_profiles WHERE por_defecto LIMIT 1`)
	}
	p, err := leerPerfil(fila)
	if errors.Is(err, pgx.ErrNoRows) {
		return PerfilGenerico(), nil
	}
	if err != nil {
		return PerfilDeExportacion{}, err
	}
	return APerfil(FilaDePerfil{p.Nombre, p.Separador, p.Unidad, p.Decimal, p.ValorSi, p.ValorNo, p.FinDeLinea, p.Columnas, p.ConEncabezado}), nil
}

// FormPerfil es el alta o la edición de un formato.
type FormPerfil struct {
	ID            string               `json:"id"`
	Nombre        string               `json:"nombre"`
	Programa      string               `json:"programa"`
	Separador     string               `json:"separador"`
	ConEncabezado bool                 `json:"conEncabezado"`
	Unidad        string               `json:"unidad"`
	Decimal       string               `json:"decimal"`
	ValorSi       string               `json:"valorSi"`
	ValorNo       string               `json:"valorNo"`
	FinDeLinea    string               `json:"finDeLinea"`
	Columnas      []ColumnaConfigurada `json:"columnas"`
	PorDefecto    bool                 `json:"porDefecto"`
}

func enumMsg(v string, opciones ...string) string {
	for _, o := range opciones {
		if v == o {
			return ""
		}
	}
	m := "Invalid option: expected one of "
	for i, o := range opciones {
		if i > 0 {
			m += "|"
		}
		m += `"` + o + `"`
	}
	return m
}

// GuardarPerfil es guardarPerfil: uno solo queda por defecto.
func (s *Servicio) GuardarPerfil(ctx context.Context, ses *auth.Sesion, f FormPerfil) error {
	nombre, msgNombre := validarTexto(f.Nombre, 2, "Poné un nombre.", 80)
	programa, msgPrograma := validarTexto(f.Programa, 0, "", 80)
	if f.ValorSi == "" {
		f.ValorSi = "Sí"
	}
	if f.ValorNo == "" {
		f.ValorNo = "No"
	}
	si, msgSi := validarTexto(f.ValorSi, 1, "", 10)
	no, msgNo := validarTexto(f.ValorNo, 1, "", 10)
	msgColumnas := ""
	for i := range f.Columnas {
		if !EsClave(f.Columnas[i].Clave) {
			msgColumnas = enumMsg(f.Columnas[i].Clave, "largo", "ancho", "cantidad", "material", "etiqueta", "veta", "cantoLargo", "cantoAncho", "numero", "cliente")
			break
		}
		var m string
		f.Columnas[i].Encabezado, m = validarTexto(f.Columnas[i].Encabezado, 0, "", 40)
		if m != "" {
			msgColumnas = m
			break
		}
	}
	if msgColumnas == "" && len(f.Columnas) == 0 {
		msgColumnas = "Elegí al menos una columna."
	}
	idMsg := ""
	if f.ID != "" && !plataforma.UUIDValido(f.ID) {
		idMsg = "Invalid UUID"
	}
	for _, m := range []string{idMsg, msgNombre, msgPrograma, enumMsg(f.Separador, ";", ",", "tab", "|"),
		enumMsg(f.Unidad, "mm", "cm", "m"), enumMsg(f.Decimal, ",", "."), msgSi, msgNo,
		enumMsg(f.FinDeLinea, "crlf", "lf"), msgColumnas} {
		if m != "" {
			return error422(m)
		}
	}
	columnas, err := jsonSinEscapar(f.Columnas)
	if err != nil {
		return err
	}
	id := f.ID
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		args := []any{nombre, opcional(programa), f.Separador, f.ConEncabezado, f.Unidad, f.Decimal, si, no, f.FinDeLinea, columnas, f.PorDefecto}
		if id != "" {
			if _, err := tx.Exec(ctx, `
				UPDATE cutting_export_profiles SET nombre = $1, programa = $2, separador = $3, con_encabezado = $4,
					unidad = $5, decimal = $6, valor_si = $7, valor_no = $8, fin_de_linea = $9, columnas = $10,
					por_defecto = $11, updated_at = now()
				WHERE id = $12`, append(args, id)...); err != nil {
				return err
			}
		} else if err := tx.QueryRow(ctx, `
			INSERT INTO cutting_export_profiles (nombre, programa, separador, con_encabezado, unidad, decimal, valor_si,
				valor_no, fin_de_linea, columnas, por_defecto)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id::text`, args...).Scan(&id); err != nil {
			return err
		}
		if f.PorDefecto && id != "" {
			_, err := tx.Exec(ctx, `UPDATE cutting_export_profiles SET por_defecto = false WHERE id <> $1`, id)
			return err
		}
		return nil
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return error422("Ya hay un formato que se llama «" + nombre + "».")
	}
	if err != nil {
		return err
	}
	accion, verbo := sqlc.AccionAuditoriaCrear, "Creó"
	if f.ID != "" {
		accion, verbo = sqlc.AccionAuditoriaEditar, "Editó"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, "corte", id, verbo+" el formato de exportación «"+nombre+"»", nil)
	return nil
}

// BorrarPerfil borra un formato.
func (s *Servicio) BorrarPerfil(ctx context.Context, ses *auth.Sesion, id string) error {
	if !plataforma.UUIDValido(id) {
		return error422("No encontramos ese formato. Puede que lo hayan borrado.")
	}
	var nombre string
	err := s.pool.QueryRow(ctx, `DELETE FROM cutting_export_profiles WHERE id = $1 RETURNING nombre`, id).Scan(&nombre)
	if errors.Is(err, pgx.ErrNoRows) {
		return error422("Ese formato ya no estaba.")
	}
	if err != nil {
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEliminar, "corte", id, "Borró el formato de exportación «"+nombre+"»", nil)
	return nil
}

// --- las tarifas ---

// TarifasActivas son las tarifas que se cobran (tarifasDeCorte).
func (s *Servicio) TarifasActivas(ctx context.Context) ([]TarifaDeCorte, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT material, price_list_id::text, precio_por_pasada, precio_por_metro_canto
		FROM cutting_rates WHERE activo ORDER BY material ASC`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (TarifaDeCorte, error) {
		var t TarifaDeCorte
		var p, c jsmath.Num
		err := r.Scan(&t.Material, &t.PriceListID, &p, &c)
		t.PrecioPorPasada, t.PrecioPorMetroCanto = p.F(), c.F()
		return t, err
	})
}

// FilaTarifa es una tarifa para la pantalla de tarifas.
type FilaTarifa struct {
	ID                  string    `json:"id"`
	Material            string    `json:"material"`
	PriceListID         *string   `json:"priceListId"`
	PrecioPorPasada     string    `json:"precioPorPasada"`
	PrecioPorMetroCanto string    `json:"precioPorMetroCanto"`
	Activo              bool      `json:"activo"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

// TodasLasTarifas son todas, activas o no, por material y lista.
func (s *Servicio) TodasLasTarifas(ctx context.Context) ([]FilaTarifa, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT id::text, material, price_list_id::text, precio_por_pasada::text, precio_por_metro_canto::text,
		       activo, created_at, updated_at
		FROM cutting_rates ORDER BY material ASC, price_list_id ASC`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (FilaTarifa, error) {
		var t FilaTarifa
		err := r.Scan(&t.ID, &t.Material, &t.PriceListID, &t.PrecioPorPasada, &t.PrecioPorMetroCanto, &t.Activo, &t.CreatedAt, &t.UpdatedAt)
		return t, err
	})
}

// FormTarifa es el alta o la edición de una tarifa.
type FormTarifa struct {
	ID                  string `json:"id"`
	Material            string `json:"material"`
	PriceListID         string `json:"priceListId"`
	PrecioPorPasada     string `json:"precioPorPasada"`
	PrecioPorMetroCanto string `json:"precioPorMetroCanto"`
	Activo              bool   `json:"activo"`
}

// GuardarTarifa es guardarTarifaDeCorte.
func (s *Servicio) GuardarTarifa(ctx context.Context, ses *auth.Sesion, f FormTarifa) error {
	material, msgMaterial := validarTexto(f.Material, 2, "Poné el material.", 80)
	msgID, msgLista, msgPrecio := "", "", ""
	if f.ID != "" && !plataforma.UUIDValido(f.ID) {
		msgID = "Invalid UUID"
	}
	if f.PriceListID != "" && !plataforma.UUIDValido(f.PriceListID) {
		msgLista = "Invalid UUID"
	}
	if f.PrecioPorPasada == "" {
		msgPrecio = "Poné el precio por pasada."
	}
	for _, m := range []string{msgID, msgMaterial, msgLista, msgPrecio} {
		if m != "" {
			return error422(m)
		}
	}
	precio := precios.ParsearImporte(f.PrecioPorPasada)
	if precio != precio || precio <= 0 || precio > 1e300 {
		return error422("El precio por pasada tiene que ser mayor a cero.")
	}
	canto := 0.0
	if s := trimJS(f.PrecioPorMetroCanto); s != "" {
		canto = precios.ParsearImporte(f.PrecioPorMetroCanto)
	}
	if canto != canto || canto < 0 || canto > 1e300 {
		return error422("El precio del metro de tapacanto no puede ser negativo.")
	}
	ahora := time.Now().UTC()
	pp, pc := jsmath.Fijo2(precio), jsmath.Fijo2(canto)
	lista := opcional(f.PriceListID)
	var err error
	if f.ID != "" {
		_, err = s.pool.Exec(ctx, `
			UPDATE cutting_rates SET material = $1, price_list_id = $2, precio_por_pasada = $3::numeric,
				precio_por_metro_canto = $4::numeric, activo = $5, updated_at = $6 WHERE id = $7`,
			material, lista, pp, pc, f.Activo, ahora, f.ID)
	} else {
		_, err = s.pool.Exec(ctx, `
			INSERT INTO cutting_rates (material, price_list_id, precio_por_pasada, precio_por_metro_canto, activo, updated_at)
			VALUES ($1, $2, $3::numeric, $4::numeric, $5, $6)`, material, lista, pp, pc, f.Activo, ahora)
	}
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			return error422(`Ya hay una tarifa de "` + material + `" para esa lista de precios.`)
		}
		return err
	}
	accion := sqlc.AccionAuditoriaCrear
	if f.ID != "" {
		accion = sqlc.AccionAuditoriaEditar
	}
	detalle := map[string]any{
		"material": material, "priceListId": lista, "precioPorPasada": pp, "precioPorMetroCanto": pc,
		"activo": f.Activo, "updatedAt": ahora.Format("2006-01-02T15:04:05.000Z"),
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, "tarifa_corte", f.ID, "Corte de "+material+": $"+pp+" por pasada", detalleOrdenado(detalle))
	return nil
}

// detalleOrdenado escribe el detalle en el orden de las claves del TS.
func detalleOrdenado(m map[string]any) json.RawMessage {
	orden := []string{"material", "priceListId", "precioPorPasada", "precioPorMetroCanto", "activo", "updatedAt"}
	b := []byte("{")
	for i, k := range orden {
		if i > 0 {
			b = append(b, ',')
		}
		kv, _ := json.Marshal(k)
		vv, _ := jsonSinEscapar(m[k])
		b = append(append(append(b, kv...), ':'), vv...)
	}
	return append(b, '}')
}

func trimJS(s string) string {
	r := []rune(s)
	i, j := 0, len(r)
	for i < j && esEspacioJS(r[i]) {
		i++
	}
	for j > i && esEspacioJS(r[j-1]) {
		j--
	}
	return string(r[i:j])
}

// --- los parámetros de las calculadoras ---

// Parametros son los de la fila única, o los del código si no hay.
func (s *Servicio) Parametros(ctx context.Context) (ParametrosDeCalculo, error) {
	var p ParametrosDeCalculo
	var v [12]jsmath.Num
	err := s.pool.QueryRow(ctx, `
		SELECT merma_machimbre, factor_pendiente, margen_seguridad, ancho_sierra_mm, rinde_rollo_membrana,
		       rinde_rollo_aislacion, separacion_techo_m, separacion_piso_m, deck_grandis_largo_m,
		       deck_grandis_ancho_m, deck_pvc_largo_m, deck_pvc_ancho_m
		FROM calculator_settings LIMIT 1`).Scan(&v[0], &v[1], &v[2], &v[3], &v[4], &v[5], &v[6], &v[7], &v[8], &v[9], &v[10], &v[11])
	if errors.Is(err, pgx.ErrNoRows) {
		return ParametrosPorDefecto(), nil
	}
	if err != nil {
		return p, err
	}
	p.MermaMachimbre, p.FactorPendiente, p.MargenSeguridad, p.AnchoSierraMm = v[0].F(), v[1].F(), v[2].F(), v[3].F()
	p.RindeRolloMembrana, p.RindeRolloAislacion, p.SeparacionTechoM, p.SeparacionPisoM = v[4].F(), v[5].F(), v[6].F(), v[7].F()
	p.Deck.Grandis = MedidaDeTabla{v[8].F(), v[9].F()}
	p.Deck.Pvc = MedidaDeTabla{v[10].F(), v[11].F()}
	return p, nil
}

// CamposDeParametros son los campos del formulario, en el orden del esquema.
var CamposDeParametros = []string{
	"mermaMachimbre", "factorPendiente", "margenSeguridad", "anchoSierraMm", "rindeRolloMembrana",
	"rindeRolloAislacion", "separacionTechoM", "separacionPisoM", "deckGrandisLargoM", "deckGrandisAnchoM",
	"deckPvcLargoM", "deckPvcAnchoM",
}

// GuardarParametros es guardarParametros: los porcentajes se escriben en
// pantalla y se guardan como fracción.
func (s *Servicio) GuardarParametros(ctx context.Context, ses *auth.Sesion, form map[string]string) error {
	porcentaje := reglaNumero{min: pf(0), msgMin: "No puede ser negativo.", max: pf(100),
		msgMax: "Más de 100 % de desperdicio no es un dato, es un error de tipeo."}
	medidaR := reglaNumero{positivo: true, msgPositivo: "Tiene que ser mayor a cero.", max: pf(100)}
	reglas := map[string]reglaNumero{
		"mermaMachimbre": porcentaje, "factorPendiente": porcentaje, "margenSeguridad": porcentaje,
		"anchoSierraMm": {min: pf(0.5), msgMin: "El disco tiene que medir más de medio milímetro.", max: pf(10), msgMax: "Más de 10 mm no es un disco de sierra."},
	}
	d := map[string]float64{}
	for _, campo := range CamposDeParametros {
		v, presente := form[campo]
		n := numeroJS(v, presente)
		r, ok := reglas[campo]
		if !ok {
			r = medidaR
		}
		if msg := validarNumero(n, r); msg != "" {
			return error422(campo + ": " + msg)
		}
		d[campo] = n
	}
	fx := jsmath.ToFixed
	vals := []any{
		fx(d["mermaMachimbre"]/100, 4), fx(d["factorPendiente"]/100, 4), fx(d["margenSeguridad"]/100, 4),
		jsmath.Num(jsmath.Round(float64(d["anchoSierraMm"]*10)) / 10),
		fx(d["rindeRolloMembrana"], 2), fx(d["rindeRolloAislacion"], 2), fx(d["separacionTechoM"], 2), fx(d["separacionPisoM"], 2),
		fx(d["deckGrandisLargoM"], 2), fx(d["deckGrandisAnchoM"], 3), fx(d["deckPvcLargoM"], 2), fx(d["deckPvcAnchoM"], 3),
	}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var id string
		err := tx.QueryRow(ctx, `SELECT id::text FROM calculator_settings LIMIT 1`).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			_, err = tx.Exec(ctx, `
				INSERT INTO calculator_settings (merma_machimbre, factor_pendiente, margen_seguridad, ancho_sierra_mm,
					rinde_rollo_membrana, rinde_rollo_aislacion, separacion_techo_m, separacion_piso_m,
					deck_grandis_largo_m, deck_grandis_ancho_m, deck_pvc_largo_m, deck_pvc_ancho_m, updated_at)
				VALUES ($1::numeric, $2::numeric, $3::numeric, $4, $5::numeric, $6::numeric, $7::numeric, $8::numeric,
					$9::numeric, $10::numeric, $11::numeric, $12::numeric, now())`, vals...)
			return err
		}
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			UPDATE calculator_settings SET merma_machimbre = $1::numeric, factor_pendiente = $2::numeric,
				margen_seguridad = $3::numeric, ancho_sierra_mm = $4, rinde_rollo_membrana = $5::numeric,
				rinde_rollo_aislacion = $6::numeric, separacion_techo_m = $7::numeric, separacion_piso_m = $8::numeric,
				deck_grandis_largo_m = $9::numeric, deck_grandis_ancho_m = $10::numeric, deck_pvc_largo_m = $11::numeric,
				deck_pvc_ancho_m = $12::numeric, updated_at = now()
			WHERE id = $13`, append(vals, id)...)
		return err
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "22003" {
		return error422("Algún número es demasiado grande para guardarlo.")
	}
	if err != nil {
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "configuracion", "", "Cambió los parámetros de las calculadoras", nil)
	return nil
}
