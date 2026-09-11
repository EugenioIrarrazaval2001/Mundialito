# Evidencia de pruebas y entrega

Fecha: 11 de septiembre de 2026. Entorno: Windows, Node 22.16.0, Microsoft Edge headless, PGlite 0.5.0 y PostgreSQL nativo 17.11. No son pruebas de producción.

La pasada conjunta anterior `node tests/run-all.mjs`, con PostgreSQL nativo habilitado, terminó con **código de salida 0**: las 33 pruebas, las cinco suites de navegador, los cinco recorridos completos y los ocho bloques de concurrencia finalizaron correctamente. El servidor PostgreSQL temporal se detuvo después de la verificación.

Después de recibir el catálogo del propietario se corrigieron seis escrituras SQL para acotarlas por `(room_code,id)`, compatible con su clave primaria compuesta UUID. Se añadieron comprobaciones previas de funciones requeridas y una prueba SQL que reutiliza el ID en dos salas, reaplica la migración y verifica aislamiento de acceso, heartbeat, salida, reconexión, draft, equipo, resultados y finalización. La nueva pasada `node --test tests/*.test.mjs` terminó **34/34, salida 0**. No se repitieron navegador ni concurrencia nativa después de este ajuste; no se ejecutó SQL en Supabase.

## Resultados ejecutados

| Prueba | Resultado y alcance |
| --- | --- |
| `node --test tests/*.test.mjs` | **34/34 pasan**: 21 casos SQL/PGlite, 9 de transporte/backend local, 2 de motor y 2 de serialización/respaldo del draft. |
| `browser.mjs` | Pasa: menú exacto a 390×844, formularios mínimos, copiar código al portapapeles, dos contextos independientes, código normalizado, draft, recarga/pestaña gemela y salida sin red. |
| `races.mjs` | Pasa: respuesta perdida después del commit de grupo, reintento sin duplicación, PIN correcto seguido de falla de ingreso, login después de volver y respuesta vieja de sala A después de entrar en B. |
| `ui-regressions.mjs` | Pasa: dos pestañas guardando la misma revisión, conflicto CAS, sin ciclos de guardado por orden de claves JSONB, picks/oferta recuperados, respuesta perdida y respaldo local corrupto. |
| `navigation-regressions.mjs` | Pasa: autoentrada que responde después de salir, snapshots desordenados de la misma sala y salida aun si falla la cuota de almacenamiento. |
| `access-matrix.mjs` | Pasa: errores de código/sala/cupo/estado y vuelta al menú; 32 cupos visibles incluyendo desconectados; exclusión y último cupo; planteles guardados; recuperación de draft de grupo con PIN desde otro contexto; visibilidad breve sin renovar presencia oculta. |
| `game-journey.mjs` | Pasan recorridos completos de rápida con dos humanos, rápida con un humano contra bots, local, grupo con PIN/historial y rápida con relevo del anfitrión durante cierre pendiente. Los modos de fallos comprueban respuestas perdidas antes y después del commit del podio, reintento/salida y cierre confirmado. |
| `native-concurrency.mjs` | Pasan 8 bloques de PostgreSQL nativo: 12 creaciones concurrentes del mismo intento; último cupo; recuperación de grupo en lobby/draft/running; inicio contra ingreso; doble finalización contra acceso; cancelación contra heartbeat; mantenimiento contra recuperación; reaplicación de migración y consultas de verificación. |
| `node --check` | Pasan las comprobaciones de sintaxis de JavaScript del proyecto, pruebas y generador. |

Los recorridos completos eligen los 18 jugadores del draft mediante la UI y avanzan con los controles existentes del torneo, incluidos penales cuando aparecen. Los fixtures SQL de las pruebas de transacciones sí preparan equipos/estados directamente para aislar la carrera probada; esos fixtures **no** se presentan como recorridos deportivos completos.

El motor `engine.js`, `rng.js` y `squads.js` conserva sus hashes originales byte por byte. Otra prueba compara simulaciones con la misma semilla, roster y decisiones.

## Cobertura de los 16 puntos de aceptación

| Punto solicitado | Evidencia principal |
| --- | --- |
| 1. Entrada, orden y móvil | `browser.mjs`, `access-matrix.mjs`; viewport móvil, no teléfono físico. |
| 2. Rápida solo, planteles y podio | Journey `solo`; selector en `access-matrix.mjs`. |
| 3. Amigos sincronizados | Journeys `multiplayer` y `handoff`, dos contextos de navegador. |
| 4. Errores y salida | Matriz de siete errores de ingreso en navegador. |
| 5. Nuevos rechazados/reconexión válida | SQL lifecycle + acceso con PIN durante draft desde otro navegador. |
| 6. Recarga, otra pestaña, draft y visibilidad | Browser, UI regressions y access matrix; reloj/fechas controlados para caducidad. |
| 7. Fallos antes/después de commit/PIN | SQL rollback, races de navegador, idempotencia PIN/transporte y journeys con fallos de podio. |
| 8. Respuestas tardías | Races, navigation regressions y transporte con promesas retenidas. |
| 9. Relevo a 90 s sin borrar equipos | Fechas SQL controladas, transferencia de coordinación y journey de relevo en cierre. |
| 10. Abandono total y vestuario único | SQL y conexiones PostgreSQL independientes; tres estados. |
| 11. No revivir, reparación sin Cron | SQL de heartbeat/reconnect/maintenance; presencia activa conserva la sala. |
| 12. Salida, cancelación y ausentes | Salida offline/draft/podio, autorización SQL, cupos visibles y decisiones de penales inmutables. |
| 13. Colisiones/idempotencia/último cupo | Colisión forzada en SQL; 12 conexiones simultáneas; último cupo contendiendo un lock real; identidad antigua frente a código reutilizado. |
| 14. Rápida sin historial/grupos conservados | Journeys rápida y grupo, doble finalización SQL, comprobación de participantes y premios. |
| 15. Credenciales, permisos, PIN | SQL como anon, grants por columna y endpoints legacy revocados, tokens inválidos y expiración del bloqueo PIN. |
| 16. Mecánica y local | Hashes originales, determinismo y recorrido local completo claramente identificado. |

## Qué se simuló y qué no

- **SQL real aislado:** PGlite ejecuta PL/pgSQL y restricciones, no respuestas RPC inventadas. Su esquema base es un contrato mínimo inferido (`base-fixture.sql`), no el esquema privado de Supabase. Se prueban IDs TEXT/UUID y actualización tras ambas migraciones legacy.
- **Concurrencia real:** el test nativo usa procesos/conexiones PostgreSQL separados. Comprueba en `pg_stat_activity` que realmente esperan locks antes de soltarlos. Crea y borra una base desechable propia; no toca una base del usuario.
- **Red simulada:** Playwright retiene, aborta o pierde respuestas concretas; el commit subyacente se ejecuta realmente en SQL cuando la prueba indica «después del commit».
- **Reloj controlado:** SQL modifica fechas de presencia/creación de fixtures y el backend local usa un `Date.now` controlado. La prueba de visibilidad dispara estados oculto/visible en el navegador. No se esperaron diez minutos por cada caso ni se ensayó WhatsApp en un teléfono físico.
- **Dependencias simuladas:** `network-regression.test.mjs` usa transporte, almacenamiento y eventos de documento simulados para reproducir respuestas tardías. Es distinto de los tests de navegador y SQL.
- Se probaron 32 participaciones y cupos, **no** un torneo de 32 navegadores físicos simultáneos.

## Pendiente exclusivamente del entorno de despliegue

1. Actualización posterior, 11 de septiembre de 2026 a las 16:55 UTC: el propietario confirmó la ejecución exitosa de la migración y aportó una fila SQL con configuración correcta y permisos básicos de anon restringidos. La consulta HTTP real de solo lectura `mundialito_api('settings',{})` respondió **200 / ok:true** usando la clave actual; el 401 previo no se reprodujo. Esto verifica conectividad y ese endpoint, no partidas completas ni todos los permisos de producción. El catálogo aportado confirma la PK compuesta UUID, pero no es un dump completo.
2. Completar las comprobaciones restantes de la [secuencia de actualización](../supabase/README.md), publicación conjunta y recorridos reales con el frontend desplegado. No se crearon salas de prueba en producción desde el agente. El fixture de tests jamás reemplaza el esquema real.
3. Cron está preparado, no instalado. Caducidad lógica al acceder y mantenimiento se probaron localmente; la ejecución periódica real necesita instalación y comprobación en el proyecto Supabase.
4. Falta validar dispositivos/navegadores físicos (especialmente Safari/iOS), latencia móvil y la carga real de su alojamiento. La emulación de viewport móvil no equivale a esa validación.

No se detectaron fallos abiertos en los escenarios locales ejecutados. La cobertura no implica que cualquier combinación posible de tiempos, dispositivos o clientes modificados esté demostrada libre de errores.

## Repetir las pruebas

Desde `Proyecto_Mundial`, con Node 22+ y Edge instalado:

```sh
npm ci
npm run test:all
```

Si no está definido `MUNDIALITO_PG_BIN`, la suite informa explícitamente que omite PostgreSQL nativo. No omite las pruebas SQL/PGlite. En este equipo también puede usarse `../.test-tools/node.exe tests/run-all.mjs`.

Para el test nativo, usar **un clúster local desechable**, nunca producción. Los binarios de Windows se obtienen siguiendo el enlace oficial de [PostgreSQL](https://www.postgresql.org/download/windows/). Ejemplo PowerShell, adaptando la ruta de binarios:

```powershell
$pgBinPruebas = 'C:\ruta\pgsql\bin'
$clusterPruebas = Join-Path ([IO.Path]::GetTempPath()) ('mundialito-pg-' + [guid]::NewGuid())
& "$pgBinPruebas\initdb.exe" -D $clusterPruebas -U postgres --locale-provider=icu --icu-locale=es --encoding=UTF8 --auth-local=trust --auth-host=trust
& "$pgBinPruebas\pg_ctl.exe" -D $clusterPruebas -l "$clusterPruebas\server.log" -o '-p 55437 -h 127.0.0.1' -w start
$env:MUNDIALITO_PG_BIN = $pgBinPruebas
$env:MUNDIALITO_PG_PORT = '55437'
try { node tests/native-concurrency.mjs }
finally { & "$pgBinPruebas\pg_ctl.exe" -D $clusterPruebas -m fast -w stop }
```

Se usa `trust` únicamente en loopback y en el clúster desechable de pruebas. El script crea una base con nombre UUID, la borra al terminar y conserva el clúster/log local para diagnóstico. No instala un servicio ni modifica Supabase.
