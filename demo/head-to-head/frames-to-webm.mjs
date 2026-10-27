// node frames-to-webm.mjs <framesDir> <out.webm>
// Encodes a WebMCP run's frames (JPEGs named for their milliseconds since the run started) into a
// constant 10 fps webm, repeating each frame until the next one, so video time is run time. Uses the
// ffmpeg Playwright installs, which reads MJPEG and writes VP9.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [dir, out] = process.argv.slice(2);
const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
const ffmpegDir = readdirSync(cache).filter(d => d.startsWith('ffmpeg-')).sort().at(-1);
const frames = readdirSync(dir).filter(f => f.endsWith('.jpg')).sort().map(f => ({ ms: Number.parseInt(f, 10), file: join(dir, f) }));
const FPS = 10;

const ff = spawn(join(cache, ffmpegDir, 'ffmpeg-mac'), ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg',
  '-framerate', String(FPS), '-i', 'pipe:0', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-deadline', 'realtime', '-cpu-used', '8',
  '-pix_fmt', 'yuv420p', '-y', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const write = buf => new Promise(r => (ff.stdin.write(buf) ? r() : ff.stdin.once('drain', r)));

let j = 0, count = 0;
for (let t = 0; t <= frames.at(-1).ms; t += 1000 / FPS, count++) {
  while (j + 1 < frames.length && frames[j + 1].ms <= t) j++;
  await write(readFileSync(frames[j].file));
}
ff.stdin.end();
ff.on('close', code => {
  console.log(`${frames.length} frames -> ${count} at ${FPS} fps (${(count / FPS).toFixed(1)}s), exit ${code}`);
  process.exit(code ?? 1);
});
