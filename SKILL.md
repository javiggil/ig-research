---
name: ig-research
description: "Investiga el contenido top de Instagram en cualquier nicho y genera un informe de marca javiggil. Úsala cuando el usuario quiera analizar qué contenido funciona en Instagram, encontrar vídeos virales u outliers, estudiar hooks, captions y patrones de un nicho, de hashtags, o de cuentas concretas (competidores o creadores). Scrapea posts, descarga y transcribe los reels top, captura screenshots de los hooks y produce un informe HTML con el diseño de marca javiggil. Dispara con frases como: analiza este nicho en Instagram, qué peta en IA, estudia estas cuentas, busca outliers de [tema], móntame un informe de contenido de Instagram."
argument-hint: "[nicho, tema o cuentas a analizar]"
user-invocable: true
---

# IG Research — javiggil

Herramienta para investigar el contenido que mejor rinde en Instagram y destilarlo en un informe de marca **javiggil**. Esta skill orquesta un motor de scripts ya instalado; tú (Claude) ejecutas el flujo paso a paso y aportas el análisis a mano, que es la parte de valor.

## Motor (no reescribir, solo usar)

Todo está centralizado **dentro de la propia skill**: **`~/.claude/skills/ig-research/`** (la raíz de la skill, en adelante `$SKILL`). Estructura: `scripts/`, `node_modules/`, `package.json`, `projects/` (los análisis) y `chrome-profile/` (la sesión de Instagram).

- `scripts/scrape.js` — controla Chrome vía CDP, recorre hashtags y/o perfiles, extrae engagement + caption, captura 3 screenshots del hook de cada reel, guarda incrementalmente, rankea por alcance y descarga audio **solo del top 15 reels**.
- `scripts/transcribe.sh` — transcribe con Whisper (modelo tiny, **autodetección de idioma**) los audios descargados.
- `scripts/report-html.js` — genera `report.html` con el **diseño de marca javiggil** (paleta, fuentes, enlaces al post original). Muestra el **top 10**.
- `scripts/report.js` — variante en markdown (opcional).
- `projects/<slug>/` — cada análisis: `config.json`, `raw-posts.json`, `transcripts/`, `hook-screenshots/`, `report-analysis.json`, `report.html`.

Si `~/.claude/skills/ig-research/scripts/` no existe, la instalación se ha perdido; avisa al usuario antes de continuar.

## Flujo (seguir en orden, no saltarse pasos)

### 0. Definir la diana con el usuario
A partir de los argumentos o preguntando lo justo, fija:
- **Tema/nicho** y **idioma/mercado** (inglés, español, ambos).
- **Fuente de datos** (lo más importante):
  - **Outliers / "lo que peta"** → hashtags amplios del tema. La rejilla "Top posts" saca los virales sin importar el tamaño de la cuenta. El ranking por alcance los flota arriba.
  - **Referentes concretos** → URLs de cuentas en `competitors`.
  - **Contenido formativo / con valor** (no espectáculo generado por IA) → hashtags formativos (`chatgpttips`, `promptengineering`, `aiautomation`, `aiforbusiness`…) + perfiles de educadores, y **filtrar el contenido generativo** en el análisis.
  - Lo ideal suele ser **híbrido**: unos hashtags + unas cuentas.

### 1. Verificar Chrome (SIEMPRE)
Chrome **crashea entre sesiones**. Antes de scrapear, comprueba:
```
curl -s http://localhost:9222/json/version
```
Si está caído, **pide al usuario** que lo relance (no intentes lanzarlo tú) con:
```
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.claude/skills/ig-research/chrome-profile"
```
y que abra **instagram.com logueado** en esa ventana. Confirma también que hay una pestaña de instagram abierta (`curl -s localhost:9222/json`).

### 2. Crear el config del proyecto
`$SKILL/projects/<slug>/config.json`:
```json
{
  "name": "Nombre legible",
  "niche": "Descripción del nicho",
  "searchTerms": ["hashtag1", "hashtag2"],
  "competitors": ["https://www.instagram.com/handle/"],
  "browserPort": 9222,
  "maxPostsPerSearch": 15,
  "maxCompetitorPosts": 12,
  "topAudio": 15,
  "topFollowers": 20
}
```
`topAudio` = nº de reels top a los que descargar audio/transcribir. `topFollowers` = nº de posts top cuyos autores se visitan para sacar seguidores y calcular el multiplicador de outlier.
`searchTerms: []` si solo perfiles. Usa un slug del nicho como nombre de carpeta.

### 3. Scrapear
```
cd ~/.claude/skills/ig-research && node scripts/scrape.js <proyecto>
```
Lánzalo en segundo plano. Avisa al usuario: **mantén la pestaña de Instagram visible y en primer plano, sin tocarla** (Chrome ralentiza pestañas en background y los screenshots saldrían en blanco). Verifica el arranque vigilando la primera línea `Top posts:` / `Found`. Hay guardado incremental: si Chrome se cae, no se pierde lo recogido.

### 4. Transcribir
```
bash scripts/transcribe.sh <proyecto>
```
Ya solo existen los audios del top 15, así que es rápido.

### 5. Análisis a mano (ESTE es el valor — lo haces tú)
El extractor ya guarda datos **exactos** por post desde el `ld+json`/`og:` de Instagram: `likesNum`, `commentsNum`, `viewsNum` y `author` (handle real). El ranking por alcance ya es fiable; tu trabajo es el análisis cualitativo.
1. Lee `raw-posts.json`. Rankea por `likesNum` (Instagram muestra los likes como cifra principal en reels y posts); `viewsNum` como respaldo. Los campos numéricos ya son exactos, no hace falta rascar `rawNumbers`.
2. **Mira el material visual** del top 10 para describir el **hook visual** (texto en pantalla, formato, escena) — el paso que sí requiere ojo humano. Reels: `hook-screenshots/<id>_0s.jpg` (3 frames). Carruseles/imágenes: `hook-screenshots/<id>_slide0.jpg`, `_slide1.jpg`… (todas las diapositivas capturadas).
3. Lee las transcripciones del top para el **hook hablado**.
4. Solo si algún `author` viene vacío (perfil sin `ld+json`/`og` legible), identifícalo en el screenshot o derívalo de `source` (`competitor:@handle`).
5. **Dedup por `postId`** en `raw-posts.json` (un post puede aparecer por hashtag Y por perfil, con href distinto).
6. Escribe `projects/<proyecto>/report-analysis.json`:
```json
{
  "posts": [
    { "postId": "...", "visualHook": "...", "spokenHook": "...", "whyItWorked": "..." }
  ],
  "winningPatterns": [ { "title": "...", "desc": "..." } ]
}
```
Cubre el **top 10** en `posts` (si no, los 7-10 usan análisis genérico). `visualHook` desde el screenshot/slides; `spokenHook` desde la transcripción (cita literal entre comillas); `whyItWorked` específico con cifras reales y framework del hook (curiosity gap, prueba social, comparación, comment-bait…). Si `post.multiplier` es alto (el post superó muchas veces a sus seguidores), **destácalo** como outlier en `whyItWorked` y/o en un patrón. 4-6 `winningPatterns` cruzando todos los posts.

### 6. Generar el informe
```
node scripts/report-html.js <proyecto>
```
Sale `report.html` con el diseño javiggil y un enlace "Ver post ↗" en cada tarjeta. Verifica el top 10 (autores y alcance) antes de presentarlo. Ábrelo con `open <ruta>` solo si el usuario lo pide o díselo para que lo abra él.

## Reglas de oro (lecciones aprendidas)
- Los números (`likesNum`/`commentsNum`/`viewsNum`) y el `author` ya vienen **exactos** del extractor (`ld+json`/`og:`). Rankea por `likesNum`. Solo verifica en el screenshot si algún dato falta.
- **Dedup por `postId`** antes de generar (un post puede salir por hashtag Y por perfil).
- **Honestidad** con el usuario: algunos perfiles dan "0 posts" por carga lenta de Instagram; si un post raro no tuviera datos estructurados, su número será aproximado (fallback heurístico).
- Para "contenido con valor" descarta explícitamente las generaciones de IA espectaculares; para "outliers/lo que peta", el ranking por likes ya los saca.

## Marca javiggil (no tocar)
Todo el branding es de **javiggil**. Ya está en `report-html.js`:
- Paleta: `#FAF5EB` (crema), `#FE4629` (rojo-naranja), `#4B0A23` (vinotinto), en OKLCH.
- Fuentes: Bricolage Grotesque (display) + Hanken Grotesk (texto).
- Cabecera y pie enlazan a `instagram.com/javiggil`.
- Nunca volver a Inter ni al dorado del tema original. Nunca side-stripes (`border-left` de color), gradient text ni em dashes en el copy.

## Limitaciones conocidas / mejoras pendientes
- ✅ HECHO: extracción de engagement y autor desde `ld+json`/`og:` (exacta), con fallback heurístico de `<span>`.
- ✅ HECHO: captura de diapositivas de carruseles (`<id>_slideN.jpg`), recorriendo con el botón "Next".
- ✅ HECHO: multiplicador de outlier (`post.multiplier` = likes / `post.followers`), mostrado como badge por post y como métrica "Top multiplicador" en el resumen.
- Reintento de perfiles "0 posts" mejorable (carga lenta tras varios hashtags). **← siguiente mejora**
