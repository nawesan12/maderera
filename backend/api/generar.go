// Package api tiene los contratos OpenAPI de la API, uno por dominio. Cada
// uno genera su paquete en internal/api/<dominio>api.
//
//	go generate ./api
package api

//go:generate go tool oapi-codegen -config sesion.gen.yaml sesion.yaml
//go:generate go tool oapi-codegen -config catalogo.gen.yaml catalogo.yaml
//go:generate go tool oapi-codegen -config contenido.gen.yaml contenido.yaml
