package catalogo

// portadas es la foto de cada rubro, la misma tabla que
// lib/db/portadas-datos.ts (tests/portadas-migracion.test.ts vigila que digan
// lo mismo). Datos fijos: van en código.
//
// La usa el importador de ISIS cuando crea un rubro que no existía: sin esto
// el rubro nuevo salía sin portada aunque su foto estuviera definida.
var portadas = map[string]string{
	"techos":               "/fotos/photo-1776624383828-e1bf5d141aa7.jpg",
	"placas":               "/sitio/placas-v1.webp",
	"ferreteria":           "/sitio/ferreteria-v1.webp",
	"construccion-en-seco": "/sitio/seco-v1.webp",
	"pisos":                "/fotos/photo-1573869908170-64b53a60d8da.jpg",
	"decks-y-escaleras":    "/fotos/photo-1585597985125-9ad0229ae71d.jpg",
}

// PortadaDe es la portada de un rubro por su slug, o nil si no tiene (la
// tarjeta dibuja entonces la placa de su tono de madera).
func PortadaDe(slug string) *string {
	if p, ok := portadas[slug]; ok {
		return &p
	}
	return nil
}
