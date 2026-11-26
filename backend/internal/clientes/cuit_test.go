package clientes

import "testing"

// Mes simulado (H002): 20-12345678-0 tiene mal el verificador (es -6) y se
// guardaba igual; la factura A la rechazaba ARCA en el mostrador.
func TestElCuitConElVerificadorMalNoSeGuarda(t *testing.T) {
	_, err := ValidarCliente(FormCliente{Nombre: "Sim Prueba", Cuit: "20-12345678-0", CondicionIva: "responsable_inscripto"})
	campo, _ := primerError(t, err)
	if campo != "cuit" {
		t.Fatalf("aceptó un CUIT con el verificador mal (error %v)", err)
	}
	c, err := ValidarCliente(FormCliente{Nombre: "Sim Prueba", Cuit: "20-12345678-6", CondicionIva: "responsable_inscripto"})
	if err != nil || c.Cuit == nil || *c.Cuit != "20123456786" {
		t.Fatalf("rechazó el CUIT bueno: %v %v", err, c.Cuit)
	}
}
