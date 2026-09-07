#!/usr/bin/env node
/* Audit how a codebase uses Supabase, so the shared-platform decisions can be
   made from evidence instead of from table names.

   Copy this one file onto the machine that has the app, then:

     node audit-supabase-usage.mjs /path/to/zhongwen-allinone > audit.md

   It reads only; it never connects to Supabase and never needs a key. Bring
   audit.md back and it answers the questions that matter:

     - which tables the app actually touches, and which are dead
     - which tables it WRITES, and whether those writes use the anon key
       (the security question) or a service-role key on a server
     - which progress/state tables carry the learner model today
       (the platform question: extend them, or replace them)
*/
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '.');
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.netlify', 'coverage', '.svelte-kit']);
const EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.mjs', '.cjs', '.html', '.sql', '.py']);

// The script's own regexes look exactly like the code it hunts for, so skip it.
const SELF = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const files = [];
(function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env.example') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(full); }
    else if (EXT.has(path.extname(e.name)) && path.resolve(full) !== SELF) files.push(full);
  }
})(ROOT);

const WRITE_OPS = /\.(insert|upsert|update|delete)\s*\(/;
// Words that can follow from/join/into/table without naming a table. Without
// this, prose in SQL comments yields tables called "if", "and" and "the".
const SQL_KEYWORDS = new Set([
  'select', 'where', 'set', 'values', 'as', 'on', 'if', 'exists', 'not', 'and',
  'or', 'to', 'all', 'each', 'row', 'function', 'trigger', 'policy', 'index',
  'view', 'materialized', 'only', 'lateral', 'unnest', 'generate_series',
  'the', 'its', 'itself', 'a', 'an', 'is', 'are', 'be', 'by', 'for', 'of',
  'in', 'it', 'this', 'that', 'them', 'one', 'any', 'every', 'public'
]);
const tables = new Map();   // name -> {reads, writes, files:Set, ops:Set}
const rpcs = new Map();     // name -> count
const clients = [];         // how the Supabase client is constructed

function note(name, isWrite, file, op) {
  if (!tables.has(name)) tables.set(name, { reads: 0, writes: 0, files: new Set(), ops: new Set() });
  const t = tables.get(name);
  if (isWrite) { t.writes++; if (op) t.ops.add(op); } else t.reads++;
  t.files.add(path.relative(ROOT, file));
}

for (const file of files) {
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }

  // .from('table') — look ahead in the chain for a write operation
  for (const m of src.matchAll(/\.from\(\s*['"`]([\w.]+)['"`]\s*\)/g)) {
    const tail = src.slice(m.index, m.index + 300);
    const write = WRITE_OPS.exec(tail);
    note(m[1], !!write, file, write && write[1]);
  }

  // .rpc('function')
  for (const m of src.matchAll(/\.rpc\(\s*['"`](\w+)['"`]/g)) {
    rpcs.set(m[1], (rpcs.get(m[1]) || 0) + 1);
  }

  // Raw REST paths, and bare table names in SQL files
  for (const m of src.matchAll(/\/rest\/v1\/(rpc\/)?(\w+)/g)) {
    if (m[1]) rpcs.set(m[2], (rpcs.get(m[2]) || 0) + 1);
    else note(m[2], false, file);
  }
  if (path.extname(file) === '.sql') {
    // Strip comments first — they are prose, not schema.
    const sql = src.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
    // "insert into", not a bare "into" — plpgsql's `select … into v_id` names a
    // variable, not a table.
    const stmt = /\b(from|join|insert\s+into|update|table)\s+(?:only\s+)?(?:if\s+(?:not\s+)?exists\s+)?(?:(\w+)\.)?(\w+)/gi;
    for (const m of sql.matchAll(stmt)) {
      const [, verb, schema, name] = m;
      if (SQL_KEYWORDS.has(name.toLowerCase())) continue;
      const qualified = schema && schema.toLowerCase() !== 'public' ? `${schema}.${name}` : name;
      note(qualified, /update|into|table/i.test(verb), file, verb.toLowerCase());
    }
  }

  // How is the client built, and with which key?
  for (const m of src.matchAll(/createClient\s*\(([^)]{0,240})\)/g)) {
    const args = m[1].replace(/\s+/g, ' ').trim();
    const key = /SERVICE_ROLE|service_role/.test(args) ? 'SERVICE_ROLE'
      : /ANON|anon|PUBLISHABLE|publishable/.test(args) ? 'anon'
        : 'unclear';
    clients.push({ file: path.relative(ROOT, file), key, args: args.slice(0, 120) });
  }
}

const sorted = [...tables.entries()].sort((a, b) =>
  (b[1].writes - a[1].writes) || (b[1].reads - a[1].reads) || a[0].localeCompare(b[0]));

const out = [];
out.push('# Supabase usage audit\n');
out.push(`Repository: \`${ROOT}\`  `);
out.push(`Files scanned: ${files.length}  `);
out.push(`Tables referenced: ${tables.size}  •  RPCs: ${rpcs.size}\n`);

out.push('## Tables the app writes\n');
out.push('These are the ones whose access model matters most.\n');
out.push('| Table | writes | reads | operations | files |');
out.push('|---|---:|---:|---|---|');
for (const [name, t] of sorted.filter(([, t]) => t.writes > 0)) {
  out.push(`| \`${name}\` | ${t.writes} | ${t.reads} | ${[...t.ops].join(', ') || '?'} | ${[...t.files].slice(0, 3).join('<br>')} |`);
}

out.push('\n## Tables the app only reads\n');
out.push('| Table | reads | files |');
out.push('|---|---:|---|');
for (const [name, t] of sorted.filter(([, t]) => t.writes === 0)) {
  out.push(`| \`${name}\` | ${t.reads} | ${[...t.files].slice(0, 3).join('<br>')} |`);
}

out.push('\n## Learner state and progress\n');
out.push('Which tables hold the learner model today — the platform question.\n');
const PROGRESS = /(progress|state|attempt|event|session|score|xp|point|streak|review|due|srs|learner|mastery)/i;
const learner = sorted.filter(([n]) => PROGRESS.test(n));
if (!learner.length) out.push('_None matched._');
else {
  out.push('| Table | writes | reads |');
  out.push('|---|---:|---:|');
  for (const [name, t] of learner) out.push(`| \`${name}\` | ${t.writes} | ${t.reads} |`);
}

out.push('\n## RPC functions called\n');
if (!rpcs.size) out.push('_None._');
else {
  out.push('| Function | calls |');
  out.push('|---|---:|');
  for (const [n, c] of [...rpcs].sort((a, b) => b[1] - a[1])) out.push(`| \`${n}\` | ${c} |`);
}

out.push('\n## Supabase clients\n');
out.push('An `anon` client that performs writes is the security question.\n');
if (!clients.length) out.push('_No createClient() call found — the client may be built elsewhere._');
else {
  out.push('| File | key | call |');
  out.push('|---|---|---|');
  for (const c of clients) out.push(`| ${c.file} | **${c.key}** | \`${c.args}\` |`);
}

out.push('\n## Tables in the database but never referenced here\n');
out.push('Paste the list from the database and compare — anything absent above is a');
out.push('candidate for deletion, but check the other repos first.\n');

console.log(out.join('\n'));
