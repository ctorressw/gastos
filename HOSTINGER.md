# Despliegue en Hostinger Web/Cloud

La aplicación requiere un plan que admita aplicaciones Node.js, Node 24, HTTPS y una ubicación persistente y privada para SQLite. Hostinger despliega cada versión en un directorio nuevo; **no guardar la base bajo `hbuilds`, `public_html` ni en el repositorio**. Antes del primer despliegue, verificar con Hostinger que el plan permite escritura persistente fuera de esas carpetas, incluido SQLite en modo WAL, y contar con copias de seguridad.

## Configuración de la aplicación

En hPanel, crear una **Web App** y escoger Express (no Vite estático). En la configuración de despliegue:

- Node.js: **24.x**.
- Directorio raíz: el directorio del proyecto.
- Gestor: npm.
- Build: `npm run build`.
- Archivo de entrada: `server/index.js`; comando de inicio, si se solicita: `npm start`.
- Variable `NODE_ENV`: `production`.
- Variable `DB_PATH`: ruta absoluta al archivo SQLite, en una carpeta privada y persistente confirmada para el plan. Por ejemplo, si Hostinger confirma esa carpeta, `/home/TU_USUARIO/saldo-data/gastos.db` (reemplazar `TU_USUARIO` por el usuario real).
- Usar el puerto `PORT` asignado por Hostinger; no fijarlo manualmente.

En producción `DB_PATH` es obligatoria y no puede apuntar al código, `hbuilds` o `public_html`. Si la base no existe, sólo se crea cuando `INITIALIZE_DB=true`. El administrador de base de datos de la interfaz está limitado a conexiones locales y no estará disponible desde la web pública.

## Crear una base nueva automáticamente

Para empezar sin copiar los datos existentes, configurá temporalmente estas variables en hPanel, además de `NODE_ENV` y `DB_PATH`:

- `INITIALIZE_DB`: `true`.
- `INITIAL_ADMIN_USERNAME`: el usuario inicial, por ejemplo `cris`.
- `INITIAL_ADMIN_PASSWORD`: su contraseña, ingresada directamente en hPanel, sin comillas.

Aplicá las variables y desplegá esta versión. La base y sus tablas se crean al iniciar; el usuario inicial sólo se crea si la base no tiene usuarios. Estos parámetros no sustituyen una base existente ni cambian contraseñas de usuarios existentes. La base nueva empieza sin tus movimientos locales. Si falta un usuario inicial válido el servidor informa el problema en el registro.

Después de comprobar que podés ingresar y guardar datos, quitá `INITIALIZE_DB`, `INITIAL_ADMIN_USERNAME` e `INITIAL_ADMIN_PASSWORD` de las variables de Hostinger y reiniciá. Así se evita crear otra base vacía accidentalmente si cambia la ruta y se retira la contraseña de la configuración. Reiniciá y desplegá una vez más para comprobar que los datos persisten. Si obtenés un 503, revisá los Runtime logs y los Build logs de Hostinger antes de cambiar la configuración.

## Llevar los datos existentes

La base local puede estar activa en modo WAL; no copiar sólo `gastos.db` mientras la app esté abierta. Desde la carpeta del proyecto, crear una copia consistente usando la API de respaldo de SQLite, con un destino que no exista todavía:

```powershell
node server/backup-db.js "D:\ruta-privada\saldo-respaldo.db"
```

El respaldo contiene datos financieros y hashes de contraseñas: guardarlo y transferirlo mediante un canal privado. Una vez confirmada la ruta persistente del servidor, subir allí la copia por SFTP/SSH con permisos privados y configurar `DB_PATH` con su ruta absoluta. No incluir el respaldo en Git, en un ZIP de despliegue ni en una carpeta pública. La copia incluye los usuarios existentes.

Antes de usar la app en producción, comprobar que el login y los movimientos existentes aparecen correctamente; probar escritura y lectura, reiniciar y volver a desplegar para comprobar que los datos siguen presentes. No reemplazar una base de producción existente sin una copia y una decisión explícita sobre la migración.

## Despliegues automáticos

Hostinger admite conectar un repositorio GitHub o GitLab desde el flujo de Web App, con despliegue automático al actualizar la rama conectada. El repositorio debe contener sólo código y dependencias declaradas; `data/*.db`, `.env` y credenciales quedan excluidos. Este directorio aún no es un repositorio Git y no se ha conectado ninguna cuenta.

Activar HTTPS en el dominio y comprobarlo antes de iniciar sesión. Después del despliegue, verificar el acceso desde celular y la importación de PDF. Crear y probar una política de copias de seguridad independiente de los despliegues.
