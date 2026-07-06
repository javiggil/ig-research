#!/usr/bin/env bash
# frames.sh — descarga el VÍDEO completo de cada reel ya transcrito de un proyecto
# y extrae una tira de fotogramas para lectura visual (análisis del CUERPO del
# vídeo más allá del hook 0-3s: texto en pantalla, cortes, b-roll, empaquetado
# visual de la idea). Complementa los screenshots de hook de scrape.js.
#
# Uso: bash scripts/frames.sh <proyecto> [fps] [--from-list id1,id2,...]
#   fps: fotogramas por segundo (defecto 0.5 = 1 cada 2s)
#   sin --from-list: procesa todo postId con transcripción en transcripts/
#
# Descarga SECUENCIAL con pausa entre reels (Instagram rate-limita las ráfagas).
# Guardado idempotente: salta lo ya bajado. El vídeo se borra tras extraer frames
# para no acumular GB; deja solo frames/<id>/frame_*.jpg.
set -uo pipefail

SKILL="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="${1:?uso: frames.sh <proyecto> [fps] [--from-list ids]}"
FPS="${2:-0.5}"
DIR="$SKILL/projects/$PROJ"
[ -d "$DIR" ] || { echo "No existe el proyecto: $DIR"; exit 1; }

COOKIES="chrome:$SKILL/chrome-profile"
FRAMESDIR="$DIR/frames"; mkdir -p "$FRAMESDIR"
TMPV="$DIR/.video-tmp"; mkdir -p "$TMPV"

# Determinar la lista de ids
IDS=""
if [ "${3:-}" = "--from-list" ]; then
  IDS="$(echo "${4:-}" | tr ',' ' ')"
else
  IDS="$(ls "$DIR/transcripts/" 2>/dev/null | grep '\.txt$' | sed 's/\.txt$//')"
fi
[ -n "$IDS" ] || { echo "Sin ids que procesar (¿transcripciones en $DIR/transcripts/?)"; exit 1; }

total=$(echo $IDS | wc -w | tr -d ' '); n=0; ok=0
echo "Proyecto $PROJ · $total reels · fps=$FPS"
for id in $IDS; do
  n=$((n+1))
  out="$FRAMESDIR/$id"
  if [ -d "$out" ] && [ -n "$(ls "$out"/frame_*.jpg 2>/dev/null)" ]; then
    echo "  [$n/$total] $id — ya tiene frames, salto"; ok=$((ok+1)); continue
  fi
  mkdir -p "$out"
  vid="$TMPV/$id.mp4"
  echo "  [$n/$total] $id — descargando vídeo..."
  python3 -m yt_dlp --cookies-from-browser "$COOKIES" \
    -f "best[ext=mp4]/best" -o "$vid" --no-warnings --quiet \
    "https://www.instagram.com/reel/$id/" 2>/dev/null \
    || python3 -m yt_dlp --cookies-from-browser "$COOKIES" \
         -f "best[ext=mp4]/best" -o "$vid" --no-warnings --quiet \
         "https://www.instagram.com/p/$id/" 2>/dev/null
  if [ ! -f "$vid" ]; then echo "     ✗ no se pudo descargar"; sleep 3; continue; fi
  ffmpeg -hide_banner -loglevel error -i "$vid" \
    -vf "fps=$FPS,scale=480:-1" -q:v 4 "$out/frame_%03d.jpg" 2>/dev/null
  cnt=$(ls "$out"/frame_*.jpg 2>/dev/null | wc -l | tr -d ' ')
  rm -f "$vid"
  echo "     ✓ $cnt frames"
  ok=$((ok+1))
  sleep 2
done
rmdir "$TMPV" 2>/dev/null
echo "Completo: $ok/$total con frames en $FRAMESDIR"
