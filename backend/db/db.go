// Package db tiene las migraciones de la base, embebidas en el binario para
// que `mjbj migrar` no dependa de archivos sueltos en el servidor.
package db

import "embed"

// Migraciones son los archivos de goose. 00001–00079 son las de drizzle,
// congeladas (ver convertir-drizzle.py); de 00080 en adelante, las nuevas.
//
//go:embed migraciones/*.sql
var Migraciones embed.FS
