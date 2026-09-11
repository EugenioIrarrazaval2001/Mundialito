// Instantánea reproducible de fuentes, migraciones, pruebas y documentación.
// No incluye dependencias instaladas, perfiles de navegador ni secretos externos.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';

const project = fileURLToPath(new URL('..', import.meta.url));
const target = resolve(project, '..', 'MUNDIALITO_FULL_CONTEXT.txt');
const excludedDirs = new Set(['node_modules', '.git', 'artifacts']);
const textTypes = new Set(['.js', '.mjs', '.sql', '.css', '.html', '.app', '.json', '.md', '.txt', '.svg', '.ps1']);
const sources = [], binaries = [];
async function collect(dir) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {if (!excludedDirs.has(entry.name)) await collect(resolve(dir, entry.name)); continue;}
    if (!entry.isFile() || entry.name.startsWith('.env') || entry.name.startsWith('journey-failure-')) continue;
    const absolute = resolve(dir, entry.name), path = 'Proyecto_Mundial/' + relative(project, absolute).replaceAll('\\', '/');
    const data = await readFile(absolute);
    const item = {path, data, hash: createHash('sha256').update(data).digest('hex')};
    if (textTypes.has(extname(entry.name)) || entry.name === '.gitignore') sources.push(item);
    else binaries.push(item);
  }
}
await collect(project);
const sort = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
sources.sort(sort); binaries.sort(sort);
const separator = '='.repeat(60);
const content = [
  'MUNDIALITO_FULL_CONTEXT — CÓDIGO ACTUAL',
  'Generado desde cero con Proyecto_Mundial/tools/build-full-context.mjs.',
  'Fuentes completas en UTF-8. El manifiesto SHA-256 corresponde a los bytes originales.',
  'Los recursos binarios se listan, no se convierten a texto. No se incluyen node_modules ni perfiles de navegador.',
  '', 'MANIFIESTO DE FUENTES',
  ...sources.map(item => `${item.hash}  ${item.path} (${item.data.length} bytes)`),
  '', 'RECURSOS BINARIOS (conservar los archivos originales al desplegar)',
  ...binaries.map(item => `${item.hash}  ${item.path} (${item.data.length} bytes)`),
  ...sources.map(item => `\n${separator}\nFILE: ${item.path}\n${separator}\n\n${item.data.toString('utf8')}`),
  '',
].join('\n');
if (process.argv.includes('--check')) {
  const actual = await readFile(target, 'utf8').catch(() => '');
  if (actual !== content) throw Error('MUNDIALITO_FULL_CONTEXT.txt no corresponde a las fuentes actuales. Ejecuta npm run context:build.');
  console.log(`PASS full context matches ${sources.length} source files and ${binaries.length} binary entries.`);
} else {
  await writeFile(target, content, 'utf8');
  console.log(`Regenerated ${target}: ${sources.length} complete source files, ${binaries.length} binary entries.`);
}
