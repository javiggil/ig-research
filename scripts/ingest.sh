#!/usr/bin/env bash
# ingest.sh — ingesta COMPLETA de los top-N reels de un proyecto para disección:
# de UNA sola descarga de vídeo saca (1) frames para lectura visual y
# (2) audio → transcripción Whisper. Minimiza las descargas contra Instagram
# (una por reel, no dos) y va SECUENCIAL con pausa para no disparar rate-limits.
#
# Uso: bash scripts/ingest.sh <proyecto> [topN] [fps]
#   topN: nº de reels top por likes a ingerir (defecto 60). Salta los ya transcritos.
#   fps:  fotogramas/seg (defecto 0.5 = 1 cada 2s)
#
# Idempotente: si ya existe transcripts/<id>.txt Y frames/<id>/, salta el reel.
# Deja: transcripts/<id>.m4a + transcripts/<id>.txt + frames/<id>/frame_*.jpg
set -uo pipefail

SKILL="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="${1:?uso: ingest.sh <proyecto> [topN] [fps]}"
TOPN="${2:-60}"
FPS="${3:-0.5}"
DIR="$SKILL/projects/$PROJ"
[ -d "$DIR" ] || { echo "No existe el proyecto: $DIR"; exit 1; }

COOKIES="chrome:$SKILL/chrome-profile"
TDIR="$DIR/transcripts"; mkdir -p "$TDIR"
FDIR="$DIR/frames"; mkdir -p "$FDIR"
TMPV="$DIR/.video-tmp"; mkdir -p "$TMPV"
WMODEL="${WHISPER_MODEL:-tiny}"

# IDs: o bien --from-list id1,id2,... o bien Top-N reels por likes desde raw-posts.json
if [ "${2:-}" = "--from-list" ]; then
  IDS="$(echo "${3:-}" | tr ',' ' ')"
  FPS="${4:-0.5}"
else
  IDS="$(node -e "
const fs=require('fs');
const d=JSON.parse(fs.readFileSync('$DIR/raw-posts.json','utf8'));
const ps=(d.posts||[]).filter(p=>p.type==='reel'&&p.postId);
ps.sort((a,b)=>(b.likesNum||0)-(a.likesNum||0));
console.log(ps.slice(0,$TOPN).map(p=>p.postId).join(' '));
")"
fi
[ -n "$IDS" ] || { echo "Sin reels que ingerir (¿raw-posts.json o --from-list?)"; exit 1; }

total=$(echo $IDS | wc -w | tr -d ' '); n=0; ok=0
echo "Ingesta $PROJ · top $total reels · whisper=$WMODEL · fps=$FPS"
for id in $IDS; do
  n=$((n+1))
  hasTxt=0; hasFrames=0
  [ -f "$TDIR/$id.txt" ] && hasTxt=1
  [ -d "$FDIR/$id" ] && [ -n "$(ls "$FDIR/$id"/frame_*.jpg 2>/dev/null)" ] && hasFrames=1
  if [ "$hasTxt" = 1 ] && [ "$hasFrames" = 1 ]; then
    echo "  [$n/$total] $id — completo, salto"; ok=$((ok+1)); continue
  fi
  vid="$TMPV/$id.mp4"
  echo "  [$n/$total] $id — descargando..."
  python3 -m yt_dlp --cookies-from-browser "$COOKIES" -f "best[ext=mp4]/best" \
    -o "$vid" --no-warnings --quiet "https://www.instagram.com/reel/$id/" 2>/dev/null \
    || python3 -m yt_dlp --cookies-from-browser "$COOKIES" -f "best[ext=mp4]/best" \
         -o "$vid" --no-warnings --quiet "https://www.instagram.com/p/$id/" 2>/dev/null
  if [ ! -f "$vid" ]; then echo "     ✗ descarga falló"; sleep 4; continue; fi
  # Frames
  if [ "$hasFrames" = 0 ]; then
    mkdir -p "$FDIR/$id"
    ffmpeg -hide_banner -loglevel error -i "$vid" -vf "fps=$FPS,scale=480:-1" -q:v 4 "$FDIR/$id/frame_%03d.jpg" 2>/dev/null
  fi
  # Audio + transcripción
  if [ "$hasTxt" = 0 ]; then
    ffmpeg -hide_banner -loglevel error -i "$vid" -vn -acodec copy "$TDIR/$id.m4a" 2>/dev/null \
      || ffmpeg -hide_banner -loglevel error -i "$vid" -vn -c:a aac "$TDIR/$id.m4a" 2>/dev/null
    python3 -m whisper "$TDIR/$id.m4a" --model "$WMODEL" --output_format txt --output_dir "$TDIR" >/dev/null 2>&1
  fi
  fcnt=$(ls "$FDIR/$id"/frame_*.jpg 2>/dev/null | wc -l | tr -d ' ')
  tok=0; [ -f "$TDIR/$id.txt" ] && tok=1
  rm -f "$vid"
  echo "     ✓ frames=$fcnt txt=$tok"
  ok=$((ok+1))
  sleep 3
done
rmdir "$TMPV" 2>/dev/null
echo "Ingesta completa: $ok/$total en $DIR"
