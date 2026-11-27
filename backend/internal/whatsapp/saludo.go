package whatsapp

import (
	"strings"

	"golang.org/x/text/unicode/norm"
)

// El saludo de una empresa no es su primera palabra: «Hola Carpintería,»
// salía de «Carpintería Prueba SRL» (mes simulado). A una persona se la
// saluda por el primer nombre; a una empresa, por el nombre entero sin la
// forma societaria. lib/whatsapp/saludo.ts es el espejo.

// formasSocietarias son las que cierran una razón social (sin puntos, en minúsculas).
var formasSocietarias = map[string]bool{
	"srl": true, "sa": true, "sas": true, "sau": true, "sh": true, "sca": true,
	"scs": true, "sc": true, "ltda": true, "coop": true, "saic": true, "saci": true,
}

// rubros son primeras palabras que dicen que el nombre es de un negocio
// (sin tildes, en minúsculas).
var rubros = map[string]bool{
	"carpinteria": true, "maderera": true, "maderas": true, "constructora": true,
	"construcciones": true, "corralon": true, "aberturas": true, "muebles": true,
	"amoblamientos": true, "ferreteria": true, "herreria": true, "taller": true,
	"fabrica": true, "distribuidora": true, "comercial": true, "grupo": true,
	"industrias": true, "estudio": true, "inmobiliaria": true, "empresa": true,
	"obras": true, "cooperativa": true, "aserradero": true, "metalurgica": true,
	// Del mes simulado: «Hola Sim» a «Sim Mueblería Atlántica» y a «Sim Obra
	// Barrio Parque».
	"muebleria": true, "obra": true, "barraca": true, "pintureria": true, "vivero": true,
	"techos": true, "estructuras": true, "arquitectura": true, "viviendas": true, "desarrollos": true,
}

func sinTildes(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		if r >= 0x300 && r <= 0x36f {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func clavePalabra(p string) string {
	return strings.Trim(strings.ReplaceAll(strings.ToLower(sinTildes(p)), ".", ""), ",;")
}

// NombreDeSaludo es cómo se nombra a alguien en «Hola …,»: el primer nombre
// de una persona o el nombre de la empresa sin «SRL», «S.A.», etc. Vacío si
// no hay nombre.
func NombreDeSaludo(nombre string) string { return NombreDeSaludoCon(nombre, primeraPalabraJS) }

// NombreDeSaludoCon es NombreDeSaludo con otra manera de tomar el nombre de
// una persona (las campañas saltan el título: «Arq. Carolina» → «Carolina»).
func NombreDeSaludoCon(nombre string, primera func(string) string) string {
	palabras := strings.FieldsFunc(trimJS(nombre), esEspacioJS)
	if len(palabras) == 0 {
		return ""
	}
	corte := len(palabras)
	for i, p := range palabras {
		if i > 0 && formasSocietarias[clavePalabra(p)] {
			corte = i
			break
		}
	}
	if corte == len(palabras) && !esNegocio(palabras) {
		return primera(nombre)
	}
	return strings.TrimRight(strings.Join(palabras[:corte], " "), ",;")
}

// esNegocio: el rubro va primero («Carpintería Ferreyra»), o segundo o
// tercero detrás de una sigla o un apodo, con algo después («RF Carpintería
// Ruiz», «Sim V1at Carpintería Ruiz»: mes 23 saludaba «Hola Sim»).
func esNegocio(palabras []string) bool {
	if rubros[clavePalabra(palabras[0])] {
		return true
	}
	for i := 1; i <= 2 && i < len(palabras)-1; i++ {
		if rubros[clavePalabra(palabras[i])] {
			return true
		}
	}
	return false
}
