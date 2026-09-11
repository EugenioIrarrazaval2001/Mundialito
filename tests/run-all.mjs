// Una orden reproducible; cada escenario termina su servidor y navegador.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url));
async function run(args, extraEnv = {}) {
  const env = {...process.env}; delete env.MUNDIALITO_TEST_MODE; delete env.MUNDIALITO_TEST_FAILURES;
  Object.assign(env, extraEnv);
  await new Promise((done, fail) => {
    const child = spawn(process.execPath, args, {cwd, env, stdio: 'inherit', windowsHide: true});
    child.on('error', fail);
    child.on('exit', code => code === 0 ? done() : fail(Error(`Falló ${args.join(' ')}: ${code}`)));
  });
}
await run(['--test', 'tests/*.test.mjs']);
for (const name of ['browser', 'races', 'ui-regressions', 'navigation-regressions', 'access-matrix']) await run([`tests/${name}.mjs`]);
for (const mode of ['multiplayer', 'solo', 'local', 'group', 'handoff']) {
  await run(['tests/game-journey.mjs'], {MUNDIALITO_TEST_MODE: mode, MUNDIALITO_TEST_FAILURES: mode === 'group' ? '1' : '0'});
}
if (process.env.MUNDIALITO_PG_BIN) await run(['tests/native-concurrency.mjs']);
else console.log('SKIP PostgreSQL nativo: no se configuró MUNDIALITO_PG_BIN. Ver tests/RESULTS.md.');
console.log('PASS acceptance runner completed; Supabase production and Cron were not accessed.');
