# Mundialito

Portada → COMENZAR → crear grupo / unirse a grupo / partida rápida / matemáticas.

En **Partida rápida**, crear solo pide tu nombre y entrega un código de cinco letras. Un amigo entra con su nombre y ese código. No hay PIN ni grupo oculto. Se puede comenzar solo contra los bots o esperar hasta 32 humanos, usando el mismo selector de planteles, draft, motor, torneo y podio.

Salir al menú está disponible incluso durante carga, draft, penales y guardado. Conserva la identidad para volver voluntariamente desde Partida rápida → Reanudar mi última partida, o entrando al grupo. No cancela la partida. El anfitrión dispone además de Cancelar partida, con confirmación. Tras el podio se puede volver al menú o crear una rápida nueva.

Las rápidas recuperan al jugador en el mismo navegador con su credencial guardada; otro dispositivo no puede apropiarse de alguien escribiendo su nombre. Los grupos conservan miembros, PIN de 4–6 dígitos, copas, medallas e historial. Para recuperar en otro dispositivo, usar el PIN. Un cambio breve de aplicación conserva el progreso; 90 segundos de ausencia permiten relevo y 10 minutos sin nadie presente cancelan la sala. Los valores provienen del servidor.

La instalación online necesita la [actualización de Supabase](supabase/README.md). El propietario confirmó su aplicación el 11 de septiembre de 2026; la consulta HTTP de configuración respondió 200 con la clave pública actual, sin reproducir el 401 anterior. Falta verificar Cron y los recorridos completos contra producción. Para jugar **local**, dejar vacías `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `js/config.js`: funciona un humano contra bots y se identifica explícitamente como local.

## Ejecutar y verificar

Servir la carpeta mediante HTTP, por ejemplo `python -m http.server 8000`, y abrir http://localhost:8000. Para online usar HTTPS en el alojamiento final.

Con Node 22 o superior:

```sh
npm ci
npm test
npm run test:browser
npm run test:races
npm run test:ui
npm run test:journey
# Toda la regresión, con cinco recorridos completos:
npm run test:all
```

Los navegadores de prueba usan Microsoft Edge instalado (`channel: msedge`), headless. La prueba de recorrido usa formularios/botones del juego, incluyendo 18 elecciones de draft y penales si aparecen. `MUNDIALITO_TEST_MODE` acepta `multiplayer` (dos amigos), `solo` (un humano contra bots con SQL), `local` (backend local), `group` (grupo con PIN e historial) y `handoff` (dos amigos, fallo de guardado y relevo del anfitrión en el podio). `MUNDIALITO_TEST_FAILURES=1` añade pérdida de respuesta antes y después del commit de finalización. En PowerShell: `$env:MUNDIALITO_TEST_MODE='local'; node tests/game-journey.mjs`.

En este equipo se preparó un Node portátil en `../.test-tools/node.exe`, ya que Node/npm no estaban en PATH. Puede ejecutar los mismos archivos de pruebas. `node_modules`, `.test-tools` y `tests/base-fixture.sql` no son archivos para desplegar como backend de producción.

Ver [resultados y cobertura](tests/RESULTS.md) y [migración, permisos y Cron](supabase/README.md). Los documentos `LOCAL_SETUP_REPORT.txt` y `LOCAL_TEST_INSTRUCTIONS.txt` son informes históricos anteriores a esta actualización; las instrucciones vigentes están aquí.

## TXT de contexto completo

`npm run context:build` reconstruye `../MUNDIALITO_FULL_CONTEXT.txt` desde cero. Incluye cada fuente, migración, prueba y documento del proyecto, más manifiesto SHA-256 y listado de recursos binarios. No incluye dependencias instaladas ni perfiles de navegador. `npm run context:check` comprueba que el TXT coincide exactamente con los archivos actuales; repetir la generación después de cualquier edición.
