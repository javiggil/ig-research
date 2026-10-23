// Ingesta COMPLETA de los reels top de un proyecto para diseccionarlos: de UNA sola descarga de vídeo
// saca (1) fotogramas para la lectura visual y (2) el audio, que luego se transcribe con whisper.cpp.
// Una descarga por reel, en fila y con pausa, para no disparar los límites de Instagram.
//
// Uso: node scripts/ingest.js <proyecto> [topN=60] [fps=0.5]
//      node scripts/ingest.js <proyecto> --from-list id1,id2,... [fps=0.5]
// Necesita el Chrome abierto con la sesión (de ahí saca las cookies).
// Idempotente: si ya existen transcripts/<id>.txt y frames/<id>/, salta el reel.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { bajarVideo, exportarCookies, ffmpeg, proyecto, puerto, wait } from './comun.js';
import { transcribir } from './transcribe.js';

const [nombre, a2, a3, a4] = process.argv.slice(2);
const dir = proyecto(nombre);
let ids, fps;
if (a2 === '--from-list') {
  ids = (a3 || '').split(',').filter(Boolean); fps = a4 || '0.5';
} else {
  const topN = +(a2 || 60); fps = a3 || '0.5';
  const posts = (JSON.parse(readFileSync(join(dir, 'raw-posts.json'), 'utf8')).posts || [])
    .filter(p => p.type === 'reel' && p.postId).sort((a, b) => (b.likesNum || 0) - (a.likesNum || 0));
  ids = posts.slice(0, topN).map(p => p.postId);
}
if (!ids.length) { console.error('Sin reels que ingerir (¿raw-posts.json o --from-list?)'); process.exit(1); }

const tdir = join(dir, 'transcripts'), fdir = join(dir, 'frames'), tmp = join(dir, '.video-tmp');
[tdir, fdir, tmp].forEach(d => mkdirSync(d, { recursive: true }));
const cookies = await exportarCookies(puerto(dir), join(dir, '.cookies.txt'));

const fotos = id => existsSync(join(fdir, id)) && readdirSync(join(fdir, id)).some(f => f.startsWith('frame_'));
let ok = 0;
console.log(`Ingesta ${nombre} · ${ids.length} reels · fps=${fps}`);
try {
  for (const [i, id] of ids.entries()) {
    const tieneTxt = existsSync(join(tdir, id + '.txt')), tieneFotos = fotos(id);
    if (tieneTxt && tieneFotos) { console.log(`  [${i + 1}/${ids.length}] ${id} · completo, salto`); ok++; continue; }
    const vid = join(tmp, id + '.mp4');
    console.log(`  [${i + 1}/${ids.length}] ${id} · descargando...`);
    if (!bajarVideo(id, vid, cookies)) { console.log('     ✗ la descarga falló'); await wait(4000); continue; }
    if (!tieneFotos) {
      mkdirSync(join(fdir, id), { recursive: true });
      ffmpeg(['-i', vid, '-vf', `fps=${fps},scale=480:-1`, '-q:v', '4', join(fdir, id, 'frame_%03d.jpg')]);
    }
    if (!tieneTxt) {
      const m4a = join(tdir, id + '.m4a');
      if (ffmpeg(['-i', vid, '-vn', '-acodec', 'copy', m4a]).status !== 0) ffmpeg(['-i', vid, '-vn', '-c:a', 'aac', m4a]);
    }
    rmSync(vid, { force: true });
    console.log(`     ✓ fotogramas=${existsSync(join(fdir, id)) ? readdirSync(join(fdir, id)).filter(f => f.startsWith('frame_')).length : 0}`);
    ok++;
    await wait(3000);
  }
} finally {
  rmSync(cookies, { force: true });
  rmSync(tmp, { recursive: true, force: true });
}
await transcribir(nombre);
console.log(`Ingesta completa: ${ok}/${ids.length} en ${dir}`);
