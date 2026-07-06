#!/bin/bash
# =============================================================================
# Transcribe audio files using Whisper
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

DONE=0
SKIPPED=0

for AUDIO in $AUDIO_FILES; do
  FILENAME=$(basename "$AUDIO")
  BASENAME="${FILENAME%.*}"
  TXT_FILE="$TRANSCRIPTS_DIR/$BASENAME.txt"

  if [ -f "$TXT_FILE" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  DONE=$((DONE + 1))
  echo "  [$DONE/$TOTAL] $BASENAME..."

  python3 -m whisper "$AUDIO" \
    --model tiny \
    --output_format txt \
    --output_dir "$TRANSCRIPTS_DIR" \
    --fp16 False \
    --verbose False \
    2>/dev/null

  if [ -f "$TXT_FILE" ]; then
    echo "    ok ($(wc -w < "$TXT_FILE" | tr -d ' ') words)"
  else
    echo "    FAILED"
  fi
done

echo ""
echo "========================================"
echo "  Transcription complete!"
echo "  Transcribed: $DONE"
echo "  Skipped (already done): $SKIPPED"
echo "========================================"
