// Package sucursales tiene las dos sucursales tal como se publican: la copia
// en Go de SUCURSALES de lib/sucursales.ts, con lo que imprimen los
// documentos y los correos.
//
// Es una constante y no filas editables por lo mismo que en el TS: la
// dirección y el teléfono son parte de la identidad del negocio, y tenerlos
// en varios lados ya dio tres versiones del domicilio del aserradero. Los
// correos decían «(0223) 474-3328» y «(0223) 483-0535», que no son los de
// lib/sucursales.ts: ahora el pie del presupuesto y el de los correos salen
// de acá. Si cambia un dato, cambia en los dos lados.
package sucursales

// Sucursal es lo publicado de un local.
type Sucursal struct {
	Slug, Nombre, Direccion, Telefono string
}

// Publicadas son las dos, en el orden de lib/sucursales.ts.
var Publicadas = []Sucursal{
	{"casa-central", "Casa Central", "Av. Juan B. Justo 4153, Mar del Plata", "223 590-3118"},
	{"aserradero", "Aserradero", "Diagonal Canosa 61, Mar del Plata", "223 506-0817"},
}
