// simulador-arca levanta el ARCA de mentira (internal/fiscal/simulador) para
// el benchmark y para probar el panel sin certificado: escribe un certificado
// y una clave de prueba en -carpeta y escucha en -escuchar.
//
//	go run ./cmd/simulador-arca -escuchar :8407 -carpeta ../bench/tanda7/arca -demora 60ms -variacion 120ms
//
// Después, a la API (y al TS de antes) se les pasa:
//
//	ARCA_CUIT=30589445259 ARCA_CERTIFICADO_ARCHIVO=<carpeta>/cert.pem
//	ARCA_CLAVE_PRIVADA_ARCHIVO=<carpeta>/clave.pem
//	ARCA_URL_WSAA=http://127.0.0.1:8407/ws/services/LoginCms
//	ARCA_URL_WSFE=http://127.0.0.1:8407/wsfev1/service.asmx
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"mjbj/internal/fiscal/simulador"
)

func main() {
	escuchar := flag.String("escuchar", ":8407", "dónde escuchar")
	carpeta := flag.String("carpeta", ".", "dónde escribir cert.pem y clave.pem")
	cuit := flag.String("cuit", "30589445259", "el CUIT del certificado")
	demora := flag.Duration("demora", 0, "lo que tarda cada respuesta (ARCA tarda 100–600 ms)")
	variacion := flag.Duration("variacion", 0, "un azar de hasta esto, sumado a la demora")
	flag.Parse()

	cert, clave, err := simulador.CertificadoDePrueba(*cuit)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(*carpeta, 0o700); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(*carpeta, "cert.pem"), []byte(cert), 0o600); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(*carpeta, "clave.pem"), []byte(clave), 0o600); err != nil {
		log.Fatal(err)
	}
	s := simulador.Armar()
	s.Demora, s.Variacion = *demora, *variacion
	log.Printf("ARCA simulado en %s (demora %s); certificado en %s", *escuchar, *demora, *carpeta)
	srv := &http.Server{Addr: *escuchar, Handler: s, ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.ListenAndServe())
}
