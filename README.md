# RADAR · ig-research

Le dices a Claude «analiza qué peta en Instagram sobre [tu tema]» y en un rato tienes un informe con los posts
que más funcionan de tu nicho: cuántos likes y comentarios tienen, cuántas veces superan a la cuenta que los
publicó, qué dicen en los primeros segundos, qué enseñan en pantalla y por qué funcionaron.

Es una skill de [Claude Code](https://claude.com/claude-code). Claude abre Instagram en tu Chrome, recorre los
hashtags y las cuentas que le digas, guarda los números y los primeros fotogramas de cada post, descarga el
audio de los 15 reels que más alcance tienen, los transcribe en tu ordenador con Whisper y escribe el análisis.

La hice para mi serie de Instagram ([@javiggil](https://www.instagram.com/javiggil)). Con ella saqué los hooks
que uso cada día.

## Qué necesitas

- Un Mac o un PC con Windows.
- [Claude Code](https://claude.com/claude-code) con tu cuenta de Claude.
- Google Chrome.
- Una cuenta de Instagram. **Usa una secundaria:** la herramienta navega con tu sesión, y si haces muchas
  búsquedas seguidas Instagram puede limitar la cuenta un rato.

## Instalación en Mac (10 minutos)

Necesitas [Homebrew](https://brew.sh). Abre la app Terminal y pega esto, línea a línea:

```bash
# 1. Lo que usa por debajo: Node, ffmpeg, whisper.cpp (la transcripción) y yt-dlp (el audio de los reels)
brew install node ffmpeg whisper-cpp yt-dlp

# 2. La skill, en la carpeta de skills de Claude Code
git clone https://github.com/javiggil/ig-research.git ~/.claude/skills/ig-research
cd ~/.claude/skills/ig-research && npm install
```

## Instalación en Windows (15 minutos)

Abre **PowerShell** (búscalo en el menú Inicio) y pega esto, línea a línea:

```powershell
# 1. Node, ffmpeg, yt-dlp y Git
winget install OpenJS.NodeJS.LTS Gyan.FFmpeg yt-dlp.yt-dlp Git.Git

# 2. whisper.cpp, la transcripción (se descomprime en tu carpeta de usuario y la skill lo encuentra sola)
Invoke-WebRequest https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip -OutFile whisper.zip
Expand-Archive whisper.zip "$env:USERPROFILE\whisper-cpp"; Remove-Item whisper.zip
```

**Cierra PowerShell y ábrelo otra vez** (así encuentra lo que acabas de instalar) y sigue:

```powershell
# 3. La skill, en la carpeta de skills de Claude Code
git clone https://github.com/javiggil/ig-research.git "$env:USERPROFILE\.claude\skills\ig-research"
cd "$env:USERPROFILE\.claude\skills\ig-research"; npm install
```

En los dos sistemas, el modelo de Whisper (unos 470 MB) se descarga solo la primera vez que transcribe.

## Antes de cada análisis: abre Chrome con la sesión

La herramienta necesita un Chrome abierto «en modo controlable» y con Instagram dentro. Cierra Chrome del todo y
ábrelo con esta orden:

```bash
# Mac (en Terminal)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.claude/skills/ig-research/chrome-profile"
```

```powershell
# Windows (en PowerShell)
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\.claude\skills\ig-research\chrome-profile"
```

Se abre un Chrome limpio. Entra en instagram.com e inicia sesión. Solo hace falta la primera vez: la sesión se
queda guardada en `chrome-profile/`, que es tuya y no sale de tu ordenador. Mientras trabaja, la herramienta
coge la sesión de ese Chrome y se la pasa a yt-dlp en un fichero temporal que borra al acabar.

## Cómo se usa

Abre Claude Code (en Terminal o en PowerShell, escribe `claude`) y pídele lo que quieras analizar:

- «Analiza qué peta en Instagram sobre recetas fáciles, en español»
- «Estudia estas cuentas: @cuenta1, @cuenta2, @cuenta3»
- «Busca outliers de #marketingdigital y #emprendimiento»

Claude te pregunta lo justo (tema, idioma, hashtags o cuentas), lanza la búsqueda y te avisa cuando acaba.
Mientras busca, **deja la pestaña de Instagram visible y sin tocarla**: si Chrome la manda al fondo, las
capturas salen en blanco.

Tarda de 10 a 30 minutos, según cuántos hashtags y cuentas le des. Al final te deja `report.html`, el informe,
dentro de la carpeta de la skill, en `projects/<tu-análisis>/`, con:

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
- **«Falta whisper-cli»:** en Mac, `brew install whisper-cpp`. En Windows, repite el paso 2 de la instalación, o pon en la variable `WHISPER_CLI` la ruta a tu `whisper-cli.exe`.
- **«Ese Chrome no tiene la sesión de Instagram iniciada»:** entra en instagram.com en el Chrome que abriste con la orden de arriba.
- **No baja el audio de los reels:** la sesión de Instagram ha caducado, o yt-dlp está viejo. Vuelve a entrar en
  instagram.com en ese Chrome y actualiza yt-dlp (`brew upgrade yt-dlp` o `winget upgrade yt-dlp.yt-dlp`).

## Qué hay dentro

- `SKILL.md`: las instrucciones que sigue Claude, paso a paso.
- `scripts/scrape.js`: recorre Instagram por el Chrome abierto, guarda números y capturas y baja el audio del top.
- `scripts/transcribe.js`: transcribe el audio en tu ordenador con whisper.cpp (nada sale a ningún servidor).
- `scripts/report-html.js`: monta el informe.
- `scripts/ingest.js` y `scripts/frames.js`: para diseccionar reels enteros (vídeo completo, fotogramas y texto).
- `scripts/comun.js`: lo que comparten, igual en Mac y en Windows.

Úsala para estudiar lo público de tu nicho y aprender de ello, no para copiar contenido ajeno. Licencia MIT.
