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
- Variable `DB_PATH`: ruta absoluta a un archivo SQLite existente, ubicado en una carpeta privada y persistente confirmada para el plan.
- Usar el puerto `PORT` asignado por Hostinger; no fijarlo manualmente.

En producción el servidor rechaza arrancar si no existe `DB_PATH` o si apunta al código, `hbuilds` o `public_html`. Esto evita crear accidentalmente una base vacía al publicar o actualizar. El administrador de base de datos de la interfaz está limitado a conexiones locales y no estará disponible desde la web pública.

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
