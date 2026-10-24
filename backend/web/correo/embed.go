// Package correo tiene la SPA del webmail ya compilada (`npm run build` deja
// el resultado en dist/), para que el binario la sirva sin archivos sueltos.
package correo

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Archivos es la SPA, con dist/ como raíz.
func Archivos() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
