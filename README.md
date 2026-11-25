# Saldo

Aplicación local para registrar ingresos y egresos, ver el saldo mensual e importar resúmenes Visa en PDF para proyectar cuotas futuras.

## Tecnología

- React + Vite
- Express
- SQLite mediante `node:sqlite`
- PDF.js para leer los resúmenes en el backend
- Cotización dólar blue venta desde Dólar Hoy, con alternativa de carga manual
- Movimientos manuales en cuotas, útiles para préstamos y compras financiadas
- Categorías personalizables con colores propios
- Seguimiento de saldo acumulado y descubierto bancario

Requiere Node.js 24 o posterior.

## Uso

```bash
npm install
npm run dev
```

La interfaz queda disponible en `http://localhost:5173` y la API en `http://localhost:3001`.

La aplicación requiere iniciar sesión. Si la base es nueva y todavía no hay usuarios, creá el primer usuario desde PowerShell en la computadora del servidor:

```powershell
$saldoUser = Read-Host 'Usuario inicial'
$saldoSecure = Read-Host 'Contraseña inicial' -AsSecureString
$saldoPassword = [System.Net.NetworkCredential]::new('', $saldoSecure).Password
@{ username = $saldoUser; password = $saldoPassword } | ConvertTo-Json -Compress | node server/setup-admin.js
Remove-Variable saldoPassword, saldoSecure
```

El comando sólo funciona cuando no existe ningún usuario y nunca modifica usuarios existentes. Luego, desde **Usuarios**, se pueden crear, editar y eliminar usuarios. Todos comparten los datos y tienen permiso para administrar usuarios. Cambiar una contraseña cierra las sesiones de ese usuario. Los hashes de contraseñas y sesiones se guardan en SQLite, no las contraseñas en texto plano.

Para generar y ejecutar la versión de producción:

```bash
npm run build
npm start
```

En ese caso toda la aplicación se sirve desde `http://localhost:3001`.

Para publicar en Internet se necesita un servidor compatible con Node.js 24, HTTPS y almacenamiento persistente para SQLite. Configurá `NODE_ENV=production` para que la cookie de sesión requiera HTTPS y mantené `data/gastos.db` y los archivos WAL en un volumen persistente. Hacé copias de seguridad coherentes de SQLite antes de migrar datos. El administrador de base de datos está limitado a conexiones locales; el resto de la aplicación requiere autenticación. Este proyecto no queda publicado automáticamente al ejecutar estos comandos.

Para Hostinger Web/Cloud, seguí las instrucciones de [HOSTINGER.md](HOSTINGER.md). En producción es obligatorio configurar `DB_PATH` fuera del código desplegado; para crear una base nueva se usa una habilitación temporal de inicialización.

## Datos

La base se crea en `data/gastos.db`. Los PDFs se procesan en memoria: no se guardan en disco. Si eliminás una importación desde la interfaz, también se eliminan sus movimientos y cuotas proyectadas.

## Importación de resúmenes

El importador reconoce:

- consumos en pesos y dólares;
- devoluciones;
- tarjeta terminada en sus últimos cuatro dígitos;
- número de cuota actual y total;
- vencimiento, cierre y total del resumen;
- impuestos y percepciones.

Antes de confirmar una importación, la aplicación muestra las tarjetas detectadas por titular y últimos cuatro dígitos. Se puede incluir o excluir cada tarjeta. Los gastos comunes del resumen —por ejemplo impuestos y percepciones no asociados a una tarjeta— se incorporan siempre.

Cada cuota pendiente se proyecta con el mismo valor de la cuota informada. Es una estimación: impuestos, redondeos o ajustes posteriores del banco pueden modificarla.

## Cotización y reportes

La sección **Reportes** intenta guardar una cotización diaria del dólar blue venta publicada en `https://dolarhoy.com/historico-dolar-blue`. Si la consulta no está disponible, conserva el último valor y permite cargar otro manualmente.

El reporte permite elegir un rango de fechas y ofrece:

- consolidado por categoría;
- importes originales en pesos y dólares;
- total equivalente en pesos según la cotización elegida;
- detalle de cada movimiento, filtrable por categoría.

La conversión es informativa y no reemplaza la cotización aplicada por el banco al vencimiento.

## Cuotas, categorías y descubierto

Al crear un movimiento se puede activar **Movimiento en cuotas**. El monto ingresado corresponde a cada cuota y la aplicación crea un movimiento mensual desde la fecha elegida. Para representar un préstamo, se puede cargar el capital recibido como ingreso y las devoluciones como un egreso en cuotas.

Las categorías se administran desde el formulario de movimientos o desde Reportes. Las categorías personalizadas se pueden renombrar y eliminar; al eliminarlas, sus movimientos pasan a `Otros`. Las categorías base mantienen su nombre para preservar la clasificación automática de los resúmenes.

El tablero calcula el saldo acumulado de la cuenta. El descubierto está configurado inicialmente en `$2.500.000` y puede modificarse junto con el saldo inicial. Cuando el saldo queda negativo:

- se muestra cuánto descubierto se está utilizando;
- se avisa antes de guardar un egreso que lo use o exceda;
- cada ingreso posterior reduce automáticamente el descubierto utilizado.
