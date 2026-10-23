// Transcribe con whisper.cpp los audios de transcripts/ que aún no tienen su .txt.
// Uso: node scripts/transcribe.js <proyecto>
// Autodetecta el idioma. WHISPER_MODEL fuerza otro modelo y WHISPER_CLI otra ruta de whisper-cli.
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { corre, ffmpeg, modeloWhisper, proyecto, whisperCli } from './comun.js';

export async function transcribir(nombre) {
  const dir = join(proyecto(nombre), 'transcripts');
  if (!existsSync(dir)) { console.log('No hay carpeta transcripts/ en el proyecto.'); return true; }
  const audios = readdirSync(dir).filter(f => /\.(mp3|m4a|webm|opus)$/i.test(f)).sort();
  if (!audios.length) { console.log('No hay audios que transcribir.'); return true; }

  console.log(`\n========================================\n  Transcribiendo ${audios.length} audios · ${nombre}\n========================================\n`);
  const cli = whisperCli();
  const modelo = await modeloWhisper();
  console.log(`  Modelo: ${modelo}\n`);

  const wav = join(tmpdir(), `igr-${process.pid}.wav`);
  let hechos = 0, fallos = 0, saltados = 0;
  for (const audio of audios) {
    const base = audio.replace(/\.[^.]+$/, '');
    const txt = join(dir, base + '.txt');
    if (existsSync(txt)) { saltados++; continue; }
    console.log(`  [${hechos + fallos + 1}/${audios.length - saltados}] ${base}...`);
    // whisper-cli quiere wav a 16 kHz y mono
    if (ffmpeg(['-i', join(dir, audio), '-ar', '16000', '-ac', '1', wav]).status !== 0) {
      console.log('    FALLO (ffmpeg no pudo convertir el audio)'); fallos++; continue;
    }
    const r = corre(cli, ['-m', modelo, '-f', wav, '-l', 'auto', '-nt', '-otxt', '-of', join(dir, base)]);
    if (existsSync(txt) && statSync(txt).size > 0) {
      hechos++;
      console.log(`    ok (${readFileSync(txt, 'utf8').split(/\s+/).filter(Boolean).length} palabras)`);
    } else {
      fallos++;
      console.log('    FALLO');
      (r.stderr || '').trim().split('\n').slice(-3).forEach(l => console.log('      ' + l));
    }
  }
  rmSync(wav, { force: true });
  console.log(`\n========================================\n  Transcritos: ${hechos} · Fallos: ${fallos} · Ya estaban: ${saltados}\n========================================`);
  return fallos === 0;
}

if (process.argv[1] && process.argv[1].endsWith('transcribe.js')) {
  transcribir(process.argv[2]).then(ok => process.exit(ok ? 0 : 1));
}
