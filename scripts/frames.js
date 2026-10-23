// Baja el VÍDEO completo de cada reel ya transcrito de un proyecto y saca una tira de fotogramas para la
// lectura visual del cuerpo del vídeo (texto en pantalla, cortes, recursos), más allá de las capturas del
// hook de scrape.js. Borra el vídeo tras sacar los fotogramas: deja solo frames/<id>/frame_*.jpg.
//
// Uso: node scripts/frames.js <proyecto> [fps=0.5] [--from-list id1,id2,...]
// Sin --from-list procesa cada post con transcripción en transcripts/. Necesita el Chrome con la sesión.
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { bajarVideo, exportarCookies, ffmpeg, proyecto, puerto, wait } from './comun.js';

const [nombre, fpsArg, flag, lista] = process.argv.slice(2);
const dir = proyecto(nombre);
const fps = fpsArg || '0.5';
const ids = flag === '--from-list' ? (lista || '').split(',').filter(Boolean)
  : (existsSync(join(dir, 'transcripts')) ? readdirSync(join(dir, 'transcripts')).filter(f => f.endsWith('.txt')).map(f => f.slice(0, -4)) : []);
if (!ids.length) { console.error(`Sin ids que procesar (¿transcripciones en ${join(dir, 'transcripts')}?)`); process.exit(1); }

const fdir = join(dir, 'frames'), tmp = join(dir, '.video-tmp');
[fdir, tmp].forEach(d => mkdirSync(d, { recursive: true }));
const cookies = await exportarCookies(puerto(dir), join(dir, '.cookies.txt'));
let ok = 0;
console.log(`Proyecto ${nombre} · ${ids.length} reels · fps=${fps}`);
try {
  for (const [i, id] of ids.entries()) {
    const out = join(fdir, id);
    if (existsSync(out) && readdirSync(out).some(f => f.startsWith('frame_'))) { console.log(`  [${i + 1}/${ids.length}] ${id} · ya tiene fotogramas, salto`); ok++; continue; }
    mkdirSync(out, { recursive: true });
    const vid = join(tmp, id + '.mp4');
    console.log(`  [${i + 1}/${ids.length}] ${id} · descargando vídeo...`);
    if (!bajarVideo(id, vid, cookies)) { console.log('     ✗ no se pudo descargar'); await wait(3000); continue; }
    ffmpeg(['-i', vid, '-vf', `fps=${fps},scale=480:-1`, '-q:v', '4', join(out, 'frame_%03d.jpg')]);
    rmSync(vid, { force: true });
    console.log(`     ✓ ${readdirSync(out).filter(f => f.startsWith('frame_')).length} fotogramas`);
    ok++;
    await wait(2000);
  }
} finally {
  rmSync(cookies, { force: true });
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`Completo: ${ok}/${ids.length} con fotogramas en ${fdir}`);
