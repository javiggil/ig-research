# RADAR · ig-research

Le dices a Claude «analiza qué peta en Instagram sobre [tu tema]» y en un rato tienes un informe con los posts
que más funcionan de tu nicho: cuántos likes y comentarios tienen, cuántas veces superan a la cuenta que los
publicó, qué dicen en los primeros segundos, qué enseñan en pantalla y por qué funcionaron.

Es una skill de [Claude Code](https://claude.com/claude-code). Claude abre Instagram en tu Chrome, recorre los
hashtags y las cuentas que le digas, guarda los números y los primeros fotogramas de cada post, descarga el
audio de los 15 reels que más alcance tienen, los transcribe en tu Mac con Whisper y escribe el análisis.

La hice para mi serie de Instagram ([@javiggil](https://www.instagram.com/javiggil)). Con ella saqué los hooks
que uso cada día.

## Qué necesitas

- Un Mac (Apple Silicon o Intel) con [Homebrew](https://brew.sh).
- [Claude Code](https://claude.com/claude-code) con tu cuenta de Claude.
- Google Chrome.
- Una cuenta de Instagram. **Usa una secundaria:** la herramienta navega con tu sesión, y si haces muchas
  búsquedas seguidas Instagram puede limitar la cuenta un rato.

## Instalación (10 minutos)

Abre la app Terminal y pega esto, línea a línea:

```bash
# 1. Lo que usa por debajo: Node, ffmpeg y whisper.cpp (la transcripción), y yt-dlp (el audio de los reels)
brew install node ffmpeg whisper-cpp
python3 -m pip install --user yt-dlp

# 2. La skill, en la carpeta de skills de Claude Code
git clone https://github.com/javiggil/ig-research.git ~/.claude/skills/ig-research
cd ~/.claude/skills/ig-research && npm install
```

El modelo de Whisper (unos 470 MB) se descarga solo la primera vez que transcribe.

## Antes de cada análisis: abre Chrome con la sesión

La herramienta necesita un Chrome abierto «en modo controlable» y con Instagram dentro. Cierra Chrome del todo
(Cmd+Q) y pega esto en Terminal:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.claude/skills/ig-research/chrome-profile"
```

Se abre un Chrome limpio. Entra en instagram.com e inicia sesión. Solo hace falta la primera vez: la sesión se
queda guardada en `chrome-profile/`, que es tuya y no sale de tu Mac.

## Cómo se usa

Abre Claude Code (en Terminal, escribe `claude`) y pídele lo que quieras analizar:

- «Analiza qué peta en Instagram sobre recetas fáciles, en español»
- «Estudia estas cuentas: @cuenta1, @cuenta2, @cuenta3»
- «Busca outliers de #marketingdigital y #emprendimiento»

Claude te pregunta lo justo (tema, idioma, hashtags o cuentas), lanza la búsqueda y te avisa cuando acaba.
Mientras busca, **deja la pestaña de Instagram visible y sin tocarla**: si Chrome la manda al fondo, las
capturas salen en blanco.

Tarda de 10 a 30 minutos, según cuántos hashtags y cuentas le des. Al final te deja `report.html`, el informe,
dentro de `~/.claude/skills/ig-research/projects/<tu-análisis>/`, con:

- el top 10 de posts por alcance, con su enlace;
- el multiplicador de cada uno: cuántas veces superó a los seguidores de quien lo publicó (los outliers);
- el hook visual (qué se ve al empezar) y el hablado (qué dice, literal);
- por qué funcionó cada uno;
- los patrones que se repiten en los que ganan.

## Si algo falla

- **«No puedo conectar con Chrome»:** Chrome no está abierto con la línea de arriba. Ciérralo (Cmd+Q) y vuelve a
  abrirlo con ella.
- **Las capturas salen en blanco:** la pestaña de Instagram no estaba en primer plano. Repite el análisis
  dejándola visible.
- **Una cuenta sale con 0 posts:** Instagram cargó lento. Pídele a Claude que repita solo esa cuenta.
- **«Falta whisper-cli»:** `brew install whisper-cpp`.
- **No baja el audio de los reels:** la sesión de Instagram ha caducado. Vuelve a entrar en instagram.com en ese
  Chrome.

## Qué hay dentro

- `SKILL.md`: las instrucciones que sigue Claude, paso a paso.
- `scripts/scrape.js`: recorre Instagram por el Chrome abierto, guarda números y capturas y baja el audio del top.
- `scripts/transcribe.sh`: transcribe el audio en tu Mac con whisper.cpp (nada sale a ningún servidor).
- `scripts/report-html.js`: monta el informe.
- `scripts/ingest.sh` y `scripts/frames.sh`: para diseccionar reels enteros (vídeo completo, fotogramas y texto).

Úsala para estudiar lo público de tu nicho y aprender de ello, no para copiar contenido ajeno. Licencia MIT.
