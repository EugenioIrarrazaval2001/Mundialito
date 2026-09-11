# Actualización de Mundialito: partida rápida y ciclo de vida

Estado al 11 de septiembre de 2026, 16:55 UTC: el propietario confirmó la ejecución exitosa de `quick_rooms_lifecycle.sql` y compartió la verificación de configuración y permisos básicos de anon, todos con los valores esperados. La consulta HTTP real `mundialito_api('settings',{})`, usando la URL/clave actual de `js/config.js`, respondió **200 / ok:true** con los plazos 15000/90000/600000/86400000 ms; el 401 anterior no se reprodujo. No se crearon partidas en producción ni se ejecutaron migraciones desde el agente. Cron y los recorridos completos en producción siguen pendientes de verificar.

## Secuencia única

1. Ejecutar `preflight.sql` en el SQL Editor como propietario. Guardar el resultado y un respaldo normal del proyecto. Verificar `rooms` y `players`: el repositorio **no contiene `schema.sql`**. No sustituir la base real por `tests/base-fixture.sql`: ese archivo es solo un contrato mínimo para pruebas.
2. Si todavía no existen las tablas de grupos, ejecutar **una vez** `add_persistent_groups.sql`. Si existen, conservarlas y saltar este paso. No volver a ejecutar ese archivo sobre una instalación actualizada con salas `cancelled`: reinstala definiciones antiguas.
3. Ejecutar **`quick_rooms_lifecycle.sql`** completo. Es la actualización final tanto si antes estaban instalados `unified_group_lobby.sql` / `abandoned_tournament_recovery.sql` como si no. Conserva grupos, miembros, hashes de PIN, sesiones e historial. Es transaccional y repetible. No requiere ejecutar los otros scripts antiguos.
4. Ejecutar `verify_lifecycle.sql`. `api_habilitada` debe ser `true`; las columnas terminadas en `debe_ser_false` deben ser `false`; las consultas de duplicados y permisos legacy/por columna deben devolver cero filas; el contador de comprobantes con token debe ser cero.
5. Publicar los archivos de frontend juntos y corregir URL/clave pública si siguen respondiendo 401. Usar HTTPS. Recargar las pestañas antiguas: los endpoints antiguos dejan de estar autorizados por diseño.
6. Opcional: habilitar Cron en Supabase y ejecutar `install_cron.sql`. Verificar una ejecución exitosa en `cron.job_run_details`. Este repositorio **prepara** el trabajo; no lo ha instalado en el servidor del propietario.

No aplicar `add_host_failover.sql`, `add_persistent_groups.sql`, `unified_group_lobby.sql` o `abandoned_tournament_recovery.sql` después de la migración final. Para reparar una instalación que lo haya hecho, revisar primero los datos/constraints y reaplicar la migración final y sus verificaciones.

## Contrato del esquema y compatibilidad comprobada

El catálogo aportado por el propietario confirma que los grupos ya existen, `rooms.host_id` y `players.id` son UUID y la clave de `players` es **`(room_code, id)`**. Faltan las columnas de la migración final; no hay que reinstalar los scripts legacy. Se conserva esa clave compuesta: presencia, salida, draft, equipo y resultados siempre limitan la escritura por sala y jugador. `tests/composite-schema.test.mjs` reproduce IDs repetidos entre salas, reaplica la actualización y verifica que ninguna de esas operaciones modifica la otra participación. El catálogo no incluye todas las definiciones, defaults ni esquemas de extensiones; no equivale a un dump completo. La migración comprueba primero sus funciones auxiliares requeridas y aborta sin cambios si falta alguna.

La actualización necesita las columnas base utilizadas por el código original: `rooms.code/status/seed/host_id/modo` y `players.id/room_code/name/squad_key/formacion/lineup/ready/resultados/joined_at`. `lineup` y `resultados` son JSONB; el código de sala es texto. La identidad del jugador/anfitrión puede ser TEXT o UUID: se probaron ambas variantes usando `%TYPE`. Añade a rooms un `id` UUID inmutable para el cliente. Si la base real ya posee una columna `rooms.id` con otro tipo, o tiene restricciones adicionales, debe revisarse el preflight antes de ejecutar. No se inventó un dump de producción.

Los torneos legacy sin grupo se clasifican como `quick`. No se autentican mediante el viejo ID global: al no disponer de credencial temporal emitida por el nuevo flujo, no se puede prometer recuperarlos. Las identidades persistentes de grupo sí se recuperan mediante su sesión o PIN. Las salas antiguas reciben una fecha de actividad al instalarse, con una tolerancia inicial de diez minutos.

## API, autorización y estados

`mundialito_api(p_action text, p_payload jsonb)` es la única entrada de escritura del navegador. Cada participación utiliza `{roomId, playerId, token}`. En grupo el token acredita al miembro persistente; en rápida es un secreto aleatorio de 256 bits generado automáticamente. SQL solo conserva su SHA-256 en `mundialito_private.credentials`, fuera de lecturas públicas. Las consultas de estado están autorizadas y devuelven un snapshot coherente de sala/participantes. El cliente sondea cada 3 segundos; ya no crea canales Realtime que puedan quedar huérfanos.

El código de cinco letras invita; el nombre no autentica. El almacenamiento del navegador conserva el secreto como credencial de portador del mismo origen para recargas y otras pestañas. No puede dar protección frente a JavaScript malicioso ejecutado en ese mismo origen; no se incluyen scripts de terceros de Supabase/CDN en el flujo nuevo. Los tokens no se muestran, no se incluyen en `players` ni se escriben en logs. La clave pública de Supabase no es una credencial de administración.

Los intentos de crear/unirse tienen UUID, secreto y huella de parámetros. Una respuesta perdida puede reenviarse sin insertar otra sala, grupo o miembro. Los registros de idempotencia permanecen como comprobantes incluso después de borrar los datos temporales de la sala; nunca permiten recrearla por un reintento antiguo. El navegador genera una operación nueva al elegir otra partida.

Los locks siguen **operación idempotente (si aplica) → grupo (si existe) → sala → participantes**. El acceso de grupos y el mantenimiento respetan el orden grupo/sala. Las transiciones de draft y torneo validan al anfitrión y el roster bajo el lock de la sala. Se congela el roster al iniciar el torneo; las desconexiones no borran jugadores ni equipos. La salida solo marca desconexión; expulsar requiere una acción del anfitrión y en draft exige ausencia. La cancelación cierra la sala para todos y la retira del índice de torneo activo. Los endpoints legacy de heartbeat/salida están revocados y deshabilitados.

`lobby` admite altas; `draft/running` solo reconexiones acreditadas. `finished/cancelled` no se reabren. Finalizar es idempotente, requiere anfitrión para el primer cierre y solamente los grupos insertan participaciones históricas/premios. Un sucesor puede finalizar usando el avance compartido. La UI confirma guardado solo tras respuesta del servidor y mantiene salida/reintento durante errores.

El draft utiliza revisión optimista, elecciones acumulativas, respaldo persistente y snapshot SQL. Los equipos enviados deben coincidir con el draft confirmado. Una pestaña antigua adopta el último snapshot en vez de deshacer picks. Se preserva el sorteo existente; el motor sigue siendo la simulación determinista del cliente, no una nueva simulación deportiva en SQL. La autorización no convierte a clientes modificados deliberadamente en un entorno antitrampas autoritativo: el anfitrión autorizado sigue aportando los resultados finales, como en la arquitectura anterior.

## Presencia, caducidad y limpieza

La fuente central es `mundialito_private.settings`. Valores iniciales: heartbeat 15000 ms, ausencia/relevo 90000 ms, abandono total 600000 ms y retención rápida terminal 86400000 ms. La respuesta SQL entrega estos valores y la hora del servidor; la UI los adopta. Para ajustar, actualizar esta única fila y recargar los clientes.

Solo ingreso/reconexión autorizados y heartbeat con página visible renuevan presencia. Las consultas y las pestañas ocultas no renuevan actividad. Caducidad se verifica **antes** de renovar, no por duración total del torneo. Una sala sin jugadores usa su fecha de actividad/creación. Los rechazos terminales y los contadores PIN devuelven resultados controlados, evitando deshacer cancelaciones/intentos con excepciones.

Cinco PIN incorrectos bloquean ese miembro durante cinco minutos. Los ceros iniciales se conservan y no se convierte el PIN a número. El login nuevo prepara un intento y un secreto antes de pedir la sesión: perder la respuesta de un PIN correcto permite recuperar la misma sesión, sin guardar el token en comprobantes SQL. El bloqueo es por miembro; una instalación que necesite protección adicional frente a ataques distribuidos deberá incorporar controles de red propios.

`mundialito_maintenance()` cancela abandonados y elimina únicamente salas rápidas terminales de más de 24 horas. Nunca elimina historiales de grupos ni partidas activas. La reparación al acceder funciona sin Cron; la eliminación periódica necesita Cron o invocación del propietario/service_role. Las solicitudes de idempotencia se conservan intencionalmente. El modo local realiza limpieza de rápidas terminales al operar en su base del navegador.

## Evidencia y comprobaciones pendientes

`npm test` incluye SQL verdadero en PostgreSQL compilado a WASM (PGlite), con pgcrypto/unaccent, tablas de prueba y roles anon/authenticated. No es un mock de RPC. También incluye pruebas de transporte con dependencias simuladas y del backend local, identificadas en [RESULTS.md](../tests/RESULTS.md). Los tests de navegador usan Edge headless y contextos independientes contra SQL real aislado. PGlite serializa consultas y por sí solo no demuestra contención entre conexiones.

Se ejecutó además `tests/native-concurrency.mjs` con **PostgreSQL nativo 17.11**, conexiones `psql` independientes y una barrera que comprueba conexiones esperando locks reales. Pasaron creación simultánea idempotente, último cupo, recuperación de grupo en los tres estados, ingreso contra inicio, doble finalización contra acceso, cancelación contra heartbeat y mantenimiento contra recuperación. También se reaplicó la migración sobre los datos de prueba. Esto verifica esas carreras concretas, no constituye una prueba matemática de ausencia de cualquier deadlock ni sustituye verificar el esquema de producción.

En staging: abrir dos clientes SQL/transacciones y lanzar `group_access` simultáneamente tras envejecer una sala de prueba; ambos deben recibir el mismo `roomId`. Repetir dos ingresos al último cupo y creación con igual `operationId/token`; comprobar con `verify_lifecycle.sql`. Hacerlo solo con grupos/salas de prueba. Verificar también trabajos Cron, latencia/red móvil y Safari/iOS real: no se ejecutaron aquí.

No publicar `tests/`, `node_modules/`, `.test-tools/` ni el TXT completo como parte del sitio web público. Son material de desarrollo/entrega; para servir el juego bastan `index.html`, `css/`, `js/` y `assets/`.

Referencias utilizadas: [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API), [Cron de Supabase](https://supabase.com/docs/guides/cron), [funciones y errores](https://supabase.com/docs/guides/database/functions), [orden y conflictos de locks de PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html).
