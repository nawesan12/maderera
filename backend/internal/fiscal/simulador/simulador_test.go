package simulador

import (
	"os"
	"testing"

	"github.com/smallstep/pkcs7"
)

// El TRA que firma node-forge (el TS de antes, lib/fiscal/proveedores/wsaa.ts)
// trae los atributos firmados sin ordenar: OpenSSL lo verifica, smallstep no.
// El simulador tiene que aceptarlo como ARCA.
func TestAceptaElCMSDeForge(t *testing.T) {
	der, err := os.ReadFile("../../../testdata/fiscal/tra-firmado-con-forge.der")
	if err != nil {
		t.Fatal(err)
	}
	p7, err := pkcs7.Parse(der)
	if err != nil {
		t.Fatal(err)
	}
	if p7.Verify() == nil {
		t.Log("smallstep ya lo verifica: se puede sacar verificarComoOpenSSL")
	}
	if err := verificarComoOpenSSL(der, p7); err != nil {
		t.Fatalf("no verifica como OpenSSL: %v", err)
	}
	der[len(der)-5] ^= 0xff // la firma tocada
	p7, _ = pkcs7.Parse(der)
	if verificarComoOpenSSL(der, p7) == nil {
		t.Fatal("una firma tocada no puede verificar")
	}
}
