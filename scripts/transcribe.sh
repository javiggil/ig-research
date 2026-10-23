#!/bin/bash
# =============================================================================
# Transcribe audio files using Whisper (whisper.cpp: whisper-cli + modelo ggml)
# 2026-10-10: antes llamaba a python3 -m whisper, que se rompe con NumPy 2 y
# fallaba en silencio (decia "Transcribed: N" sin escribir ningun .txt).
# Processes all audio files in transcripts/ that don't have a matching .txt
# Usage: bash scripts/transcribe.sh <project-name>
# =============================================================================

PROJECT="$1"
if [ -z "$PROJECT" ]; then
  echo "Usage: bash scripts/transcribe.sh <project-name>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRANSCRIPTS_DIR="$SCRIPT_DIR/../projects/$PROJECT/transcripts"

if [ ! -d "$TRANSCRIPTS_DIR" ]; then
  echo "No transcripts directory found for project: $PROJECT"
  exit 1
fi

AUDIO_FILES=$(find "$TRANSCRIPTS_DIR" -name "*.mp3" -o -name "*.m4a" -o -name "*.webm" -o -name "*.opus" | sort)
TOTAL=$(echo "$AUDIO_FILES" | grep -c "." || true)

if [ "$TOTAL" -eq 0 ]; then
  echo "No audio files to transcribe."
  exit 0
fi

echo ""
echo "========================================"
echo "  Transcribing $TOTAL audio files"
echo "  Project: $PROJECT"
echo "========================================"
echo ""

# Modelo multilingue (autodeteccion de idioma). Se puede forzar con WHISPER_MODEL=/ruta/al/modelo.bin.
# Busca uno ya descargado y, si no hay ninguno, baja ggml-small (unos 470 MB) a ~/.cache/whisper-cpp.
MODEL="${WHISPER_MODEL:-}"
if [ -z "$MODEL" ]; then
  for dir in "$HOME/.cache/whisper-cpp" "$HOME/.cache/hyperframes/whisper/models"; do
    for m in ggml-small.bin ggml-medium.bin ggml-large-v3.bin; do
      if [ -z "$MODEL" ] && [ -f "$dir/$m" ]; then MODEL="$dir/$m"; fi
    done
  done
fi
if ! command -v whisper-cli >/dev/null 2>&1; then
  echo "Falta whisper-cli (brew install whisper-cpp)."
  exit 1
fi
if [ -z "$MODEL" ]; then
  MODEL="$HOME/.cache/whisper-cpp/ggml-small.bin"
  echo "  Primera vez: descargo el modelo de Whisper (ggml-small, ~470 MB) en $MODEL"
  mkdir -p "$(dirname "$MODEL")"
  curl -fL --progress-bar -o "$MODEL.part" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin \
    && mv "$MODEL.part" "$MODEL" || { echo "No pude descargar el modelo."; rm -f "$MODEL.part"; exit 1; }
fi
if [ ! -f "$MODEL" ]; then
  echo "El modelo $MODEL no existe."
  exit 1
fi
echo "  Modelo: $MODEL"
echo ""

DONE=0
SKIPPED=0
FAILED=0
TMP_WAV="$(mktemp -t igr-wav).wav"
trap 'rm -f "$TMP_WAV"' EXIT

for AUDIO in $AUDIO_FILES; do
  FILENAME=$(basename "$AUDIO")
  BASENAME="${FILENAME%.*}"
  TXT_FILE="$TRANSCRIPTS_DIR/$BASENAME.txt"

  if [ -f "$TXT_FILE" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo "  [$((DONE + FAILED + 1))/$TOTAL] $BASENAME..."

  # whisper-cli necesita wav 16 kHz mono
  if ! ffmpeg -nostdin -loglevel error -y -i "$AUDIO" -ar 16000 -ac 1 "$TMP_WAV"; then
    echo "    FAILED (ffmpeg no pudo convertir el audio)"
    FAILED=$((FAILED + 1))
    continue
  fi
  ERR=$(whisper-cli -m "$MODEL" -f "$TMP_WAV" -l auto -nt -otxt -of "$TRANSCRIPTS_DIR/$BASENAME" 2>&1 >/dev/null)

  if [ -s "$TXT_FILE" ]; then
    DONE=$((DONE + 1))
    echo "    ok ($(wc -w < "$TXT_FILE" | tr -d ' ') words)"
  else
    FAILED=$((FAILED + 1))
    echo "    FAILED"
    echo "$ERR" | tail -3 | sed 's/^/      /'
  fi
done

echo ""
echo "========================================"
echo "  Transcription complete!"
echo "  Transcribed: $DONE"
echo "  Failed: $FAILED"
echo "  Skipped (already done): $SKIPPED"
echo "========================================"
[ "$FAILED" -eq 0 ]
