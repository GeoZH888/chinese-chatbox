/* Assemble dist/ — the exact set of files that go on the CDN.

   There is nothing to compile; this exists so the published output is an
   explicit list rather than "whatever happens to be in the folder". The repo
   root also holds node_modules, the local server, the tests and (on a
   developer's machine) a .env, and none of that belongs on a public site.

   Run: node build.mjs   (Netlify runs it as the build command)
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'dist');

// Everything the browser loads, and nothing else.
const FILES = ['index.html'];
const DIRS = [{ from: 'src', include: /\.(js|css)$/ }];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const copied = [];

for (const file of FILES) {
  fs.copyFileSync(path.join(ROOT, file), path.join(OUT, file));
  copied.push(file);
}

for (const dir of DIRS) {
  const src = path.join(ROOT, dir.from);
  const dest = path.join(OUT, dir.from);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (!dir.include.test(name)) continue;
    fs.copyFileSync(path.join(src, name), path.join(dest, name));
    copied.push(dir.from + '/' + name);
  }
}

// A missing script would leave a half-working page, so fail the build instead:
// every <script src> and <link href> in the page must exist in the output.
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(https?:|data:|#|\/\/)/.test(u));
const missing = refs.filter((u) => !fs.existsSync(path.join(OUT, u)));
if (missing.length) {
  console.error('build failed — index.html references files that are not in dist/:');
  missing.forEach((m) => console.error('  ' + m));
  process.exit(1);
}

console.log('dist/ built with ' + copied.length + ' files:');
copied.forEach((f) => console.log('  ' + f));
console.log('all ' + refs.length + ' page references resolve.');
