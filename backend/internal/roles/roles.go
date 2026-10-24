// Package roles dice qué rol del panel entra a cada pantalla: lib/roles.ts,
// la fuente única de permisos del panel.
//
// **Mientras convivan, el mapa está en los dos lados**, y
// testdata/golden/roles (generado del TS por scripts/golden/roles.ts) es lo
// que asegura que digan lo mismo: si se cambia uno sin el otro, el test
// falla. Al terminar la mudanza queda solo este.
//
// Las rutas son las de las pantallas de Next. La API de Go las usa para dos
// cosas: a quién avisar de algo que se ve en una pantalla (push, tiempo
// real), y para que cada ruta de la API exija los mismos roles que la
// pantalla que la usa.
package roles

import (
	"strings"

	"mjbj/internal/sqlc"
)

// Acceso es ACCESO de lib/roles.ts. Adentro de una carpeta manda la clave más
// larga: /admin/cortes/tarifas es solo del admin aunque /admin/cortes deje
// entrar al aserradero.
var Acceso = map[string][]sqlc.StaffRole{
	"/admin":                        {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor, sqlc.StaffRoleDeposito},
	"/admin/pedidos":                {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor, sqlc.StaffRoleDeposito},
	"/admin/whatsapp":               {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor},
	"/admin/whatsapp/configuracion": {sqlc.StaffRoleAdmin},
	"/admin/presupuestos":           {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor},
	"/admin/cortes":                 {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor, sqlc.StaffRoleDeposito, sqlc.StaffRoleAserradero},
	"/mostrador":                    {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor},
	"/atencion":                     {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor},
	"/taller":                       {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor, sqlc.StaffRoleDeposito, sqlc.StaffRoleAserradero},
	"/admin/productos":              {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor},
	"/admin/stock":                  {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor, sqlc.StaffRoleDeposito},
	"/admin/precios":                {sqlc.StaffRoleAdmin},
	"/admin/calculadoras":           {sqlc.StaffRoleAdmin},
	"/admin/clientes":               {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor},
	"/admin/profesionales":          {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor},
	"/admin/documentacion":          {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor},
	"/admin/contenido":              {sqlc.StaffRoleAdmin},
	"/admin/eventos":                {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor},
	"/admin/pagos":                  {sqlc.StaffRoleAdmin},
	"/admin/facturacion":            {sqlc.StaffRoleAdmin},
	"/admin/arca":                   {sqlc.StaffRoleAdmin},
	"/admin/avisos":                 {sqlc.StaffRoleAdmin},
	"/admin/campanas":               {sqlc.StaffRoleAdmin},
	"/admin/caja":                   {sqlc.StaffRoleAdmin},
	"/admin/proveedores":            {sqlc.StaffRoleAdmin},
	"/admin/recepciones":            {sqlc.StaffRoleAdmin},
	"/admin/compras":                {sqlc.StaffRoleAdmin},
	"/admin/compras/ordenes":        {sqlc.StaffRoleAdmin},
	"/admin/compras/facturas":       {sqlc.StaffRoleAdmin},
	"/admin/compras/pagos":          {sqlc.StaffRoleAdmin},
	"/admin/compras/gastos":         {sqlc.StaffRoleAdmin},
	"/admin/cheques":                {sqlc.StaffRoleAdmin},
	"/admin/cierre":                 {sqlc.StaffRoleAdmin},
	"/admin/reportes":               {sqlc.StaffRoleAdmin},
	"/admin/sucursales":             {sqlc.StaffRoleAdmin},
	"/admin/envios":                 {sqlc.StaffRoleAdmin},
	"/admin/cortes/tarifas":         {sqlc.StaffRoleAdmin},
	"/admin/precios/formas-de-pago": {sqlc.StaffRoleAdmin},
	"/admin/migracion":              {sqlc.StaffRoleAdmin},
	"/admin/bitacora":               {sqlc.StaffRoleAdmin},
	"/admin/ayuda":                  {sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor, sqlc.StaffRoleDeposito, sqlc.StaffRoleAserradero},
}

// QuienEntra son los roles de exactamente esa ruta, o nil si no está
// declarada (quienEntra del TS).
func QuienEntra(ruta string) []sqlc.StaffRole { return Acceso[ruta] }

// PuedeEntrar es puedeEntrar del TS: busca la clave más larga que contiene a
// la ruta; sin ninguna, entra todo el personal.
func PuedeEntrar(ruta string, rol *sqlc.StaffRole) bool {
	if rol == nil {
		return false
	}
	var mejor []sqlc.StaffRole
	largo := -1
	for clave, permitidos := range Acceso {
		if ruta != clave && !strings.HasPrefix(ruta, clave+"/") {
			continue
		}
		if len(clave) > largo {
			largo = len(clave)
			mejor = permitidos
		}
	}
	if largo < 0 {
		return true
	}
	for _, r := range mejor {
		if r == *rol {
			return true
		}
	}
	return false
}

// InicioDelRol es a dónde va cada rol al entrar: el aserradero, a su
// pantalla; el resto, al panel.
func InicioDelRol(rol *sqlc.StaffRole) string {
	if rol != nil && *rol == sqlc.StaffRoleAserradero {
		return "/taller"
	}
	return "/admin"
}
