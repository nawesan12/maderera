#!/usr/bin/env bash
# Baja el modelo de whisper.cpp que usa el servicio `whisper` del compose de
# producción (los audios del bot de WhatsApp). Va afuera del repo y de la
# imagen: son 190 MB que no cambian. Se corre una vez en el servidor.
#
#   ./scripts/whisper-modelo.sh
set -euo pipefail
destino="${WHISPER_MODELOS:-$(dirname "$0")/../../whisper-modelos}"
mkdir -p "$destino"
archivo="$destino/ggml-small-q5_1.bin"
if [ -f "$archivo" ]; then
  echo "Ya está: $archivo"
  exit 0
fi
curl -fSL -o "$archivo.parcial" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin
mv "$archivo.parcial" "$archivo"
echo "Listo: $archivo"
