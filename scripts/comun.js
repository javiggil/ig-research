// Lo que comparten los scripts, igual en Mac, Windows y Linux:
// la sesión de Instagram (sacada del Chrome abierto), yt-dlp, ffmpeg y whisper.cpp con su modelo.
import CDP from 'chrome-remote-interface';
import { spawnSync } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import https from 'https';

export const SKILL = join(import.meta.dirname, '..');
export const WIN = process.platform === 'win32';
export const wait = ms => new Promise(r => setTimeout(r, ms));

export function proyecto(nombre) {
  if (!nombre) { console.error('Falta el nombre del proyecto.'); process.exit(1); }
  const dir = join(SKILL, 'projects', nombre);
  if (!existsSync(dir)) { console.error(`No existe el proyecto: ${dir}`); process.exit(1); }
  return dir;
}

export function puerto(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).browserPort || 9222; } catch { return 9222; }
}

// ¿Está este programa en el PATH?
export function hay(cmd) {
  return spawnSync(WIN ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;
}

// Ejecuta sin pasar por la shell (así las rutas con espacios valen igual en Windows)
export function corre(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 0, stdio: opts.stdio ?? 'pipe' });
}

// La sesión de Instagram, sacada del Chrome abierto por CDP y escrita como cookies.txt para yt-dlp.
// Así no hace falta que yt-dlp descifre las cookies del perfil, que en Windows no puede.
export async function exportarCookies(port, archivo, client = null) {
  let c = client, propio = false;
  if (!c) {
    try {
      const tabs = await CDP.List({ port });
      const tab = tabs.find(t => t.type === 'page') || tabs[0];
      c = await CDP({ port, target: tab.id });
      propio = true;
    } catch {
      console.error(`\nNo puedo conectar con Chrome en el puerto ${port}. Ábrelo con --remote-debugging-port=${port} y la sesión de Instagram iniciada.\n`);
      process.exit(1);
    }
  }
  const { cookies } = await c.Network.getCookies({ urls: ['https://www.instagram.com/', 'https://i.instagram.com/'] });
  if (propio) await c.close();
  if (!cookies.some(k => k.name === 'sessionid')) {
    console.error('\nEse Chrome no tiene la sesión de Instagram iniciada: entra en instagram.com y vuelve a lanzarlo.\n');
    process.exit(1);
  }
  const lineas = ['# Netscape HTTP Cookie File'];
  for (const k of cookies) {
    const dom = k.domain.startsWith('.') ? k.domain : '.' + k.domain;
    lineas.push([dom, 'TRUE', k.path || '/', k.secure ? 'TRUE' : 'FALSE', Math.max(0, Math.floor(k.expires || 0)), k.name, k.value].join('\t'));
  }
  writeFileSync(archivo, lineas.join('\n') + '\n', { mode: 0o600 });
  return archivo;
}

// yt-dlp: el ejecutable si está; si no, el módulo de Python
export function ytdlp(args, timeout = 120000) {
  if (hay('yt-dlp')) return corre('yt-dlp', args, { timeout });
  for (const py of WIN ? ['py', 'python'] : ['python3', 'python']) {
    if (hay(py)) return corre(py, ['-m', 'yt_dlp', ...args], { timeout });
  }
  console.error('Falta yt-dlp (Mac: brew install yt-dlp · Windows: winget install yt-dlp.yt-dlp).');
  process.exit(1);
}

// Baja un reel o post con la sesión. Prueba /reel/ y luego /p/.
export function bajarVideo(id, destino, cookies) {
  for (const tipo of ['reel', 'p']) {
    ytdlp(['--cookies', cookies, '-f', 'best[ext=mp4]/best', '-o', destino, '--no-warnings', '--quiet', `https://www.instagram.com/${tipo}/${id}/`]);
    if (existsSync(destino)) return true;
  }
  return false;
}

export function ffmpeg(args) {
  if (!hay('ffmpeg')) { console.error('Falta ffmpeg (Mac: brew install ffmpeg · Windows: winget install Gyan.FFmpeg).'); process.exit(1); }
  return corre('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

// whisper.cpp: WHISPER_CLI si se ha puesto; si no, whisper-cli del PATH
export function whisperCli() {
  if (process.env.WHISPER_CLI && existsSync(process.env.WHISPER_CLI)) return process.env.WHISPER_CLI;
  if (hay('whisper-cli')) return 'whisper-cli';
  // En Windows, la guía lo descomprime en %USERPROFILE%\whisper-cpp (el .exe va en una subcarpeta)
  const base = join(homedir(), 'whisper-cpp');
  for (const sub of ['', 'Release', 'bin', join('bin', 'Release')]) {
    for (const exe of ['whisper-cli.exe', 'whisper-cli']) if (existsSync(join(base, sub, exe))) return join(base, sub, exe);
  }
  console.error('Falta whisper-cli (Mac: brew install whisper-cpp · Windows: la carpeta de whisper.cpp en el PATH, o WHISPER_CLI con la ruta a whisper-cli.exe).');
  process.exit(1);
}

// El modelo: WHISPER_MODEL, uno ya bajado o, la primera vez, ggml-small (~470 MB) a ~/.cache/whisper-cpp
export async function modeloWhisper() {
  if (process.env.WHISPER_MODEL) return process.env.WHISPER_MODEL;
  const dirs = [join(homedir(), '.cache', 'whisper-cpp'), join(homedir(), '.cache', 'hyperframes', 'whisper', 'models')];
  for (const d of dirs) for (const m of ['ggml-small.bin', 'ggml-medium.bin', 'ggml-large-v3.bin']) {
    if (existsSync(join(d, m))) return join(d, m);
  }
  const destino = join(dirs[0], 'ggml-small.bin');
  console.log(`  Primera vez: descargo el modelo de Whisper (ggml-small, ~470 MB) en ${destino}`);
  mkdirSync(dirname(destino), { recursive: true });
  await descargar('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin', destino + '.part');
  renameSync(destino + '.part', destino);
  return destino;
}

function descargar(url, destino, saltos = 0) {
  return new Promise((ok, mal) => {
    https.get(url, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && saltos < 5) {
        r.resume();
        return ok(descargar(new URL(r.headers.location, url).toString(), destino, saltos + 1));
      }
      if (r.statusCode !== 200) { r.resume(); return mal(new Error(`HTTP ${r.statusCode} al bajar ${url}`)); }
      const f = createWriteStream(destino);
      r.pipe(f);
      f.on('finish', () => f.close(ok));
      f.on('error', e => { rmSync(destino, { force: true }); mal(e); });
    }).on('error', mal);
  });
}
