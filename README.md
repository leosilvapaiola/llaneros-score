# Linea Viva

Aplicacion web movil para registrar la ofensiva de un equipo de softball. Guarda cada aparicion al bate y cada movimiento de corredores para poder reconstruir una entrada cuando la planilla oficial tenga errores.

## Funciones actuales

- Roster propio con numero, nombre y posicion.
- Roster permanente precargado desde JSON y editor para cambios ocasionales.
- Disponibilidad por partido y posicion asignada con `P`, `C`, `1B`, `2B`, `3B`, `SS`, `LF`, `CF`, `RF`, `SF`, `DH` o `Banco`.
- Control de posiciones duplicadas, con excepcion de `Banco`.
- Lineup reordenable de 10 u 11 titulares antes del partido.
- Vista **Line-up** separada para sustituciones durante el partido.
- Reingreso del titular solamente en su lugar original del orden al bate.
- Un sustituto que regresa al banco queda fuera por el resto del partido.
- Sustituciones y turnos del jugador entrante registrados en la Bitacora.
- Finalizacion manual en cualquier entrada con doble confirmacion.
- Entrada, outs, carreras y bateador actual.
- Diamante interactivo con corredores en base.
- Resultados preconfigurados con destinos editables para cada corredor.
- Eventos de corredor separados del turno al bate: robo, atrapado robando, wild pitch, passed ball y avance.
- Bitacora con bases antes y despues de cada evento.
- Deshacer exacto, incluso despues del tercer out.
- Persistencia local, respaldo JSON e importacion.
- Aplicacion instalable y disponible sin conexion despues de la primera visita.

El MVP registra solamente la ofensiva de nuestro equipo. No incluye el lineup ni las jugadas ofensivas del rival.

## Ejecutar en Linux

No requiere Node.js, npm, paquetes ni compilacion. Solo se necesita un servidor HTTP para cargar los modulos JavaScript.

```bash
cd /home/leosilvapaiola/leosilvapaiola-git/scorekeeping-softball
python3 -m http.server 8080
```

Abrir `http://localhost:8080`.

## Flujo recomendado

1. Agregar jugadores en **Roster**.
2. Abrir **Partido**, ordenar el lineup e iniciar.
3. Elegir el resultado del turno y revisar los destinos sugeridos.
4. Ajustar cualquier destino especial y registrar la jugada.
5. Tocar una base ocupada para registrar un evento del corredor sin avanzar el lineup.
6. Abrir **Line-up** para sustituir un jugador. El reemplazo conserva el lugar del orden al bate.
7. Consultar **Bitacora** o deshacer la ultima jugada si hubo un error.
8. Al cumplirse el tiempo, usar **Finalizar** y completar las dos confirmaciones.
9. Descargar un respaldo JSON al terminar el partido.

### Regla de reingreso

Cada lugar del orden al bate conserva al titular original. Cuando entra un jugador del banco, ocupa ese mismo lugar y sus apariciones se guardan a su nombre. El titular sustituido queda en el banco y puede reingresar solamente en su lugar original. Si el titular reingresa o entra otro jugador, el sustituto saliente queda marcado como no disponible y no puede volver al juego.

## Roster precargado

El roster inicial vive en `data/roster.json`. Para cargar el plantel real antes de publicar, completar la lista `players`:

```json
{
	"team": "Nombre del equipo",
	"players": [
		{ "id": "p-01", "number": "7", "name": "Nombre Apellido", "position": "SS" },
		{ "id": "p-02", "number": "24", "name": "Nombre Apellido", "position": "BENCH" }
	]
}
```

Los codigos validos son `P`, `C`, `1B`, `2B`, `3B`, `SS`, `LF`, `CF`, `RF`, `SF`, `DH` y `BENCH`. La posicion del JSON es solamente el valor habitual que aparece seleccionado al preparar un partido; puede cambiarse para cada fecha.

El archivo se importa la primera vez que el navegador abre la aplicacion. Despues, **Editar roster** guarda cambios locales. Para volver a cargar una version nueva del JSON, exportar primero cualquier partido necesario y usar **Borrar todos los datos**.

Los datos viven en `localStorage` dentro del navegador. Borrar los datos del sitio o cambiar de dispositivo elimina el estado local salvo que exista un respaldo JSON.

## Publicar en GitHub Pages

Este repositorio ya esta preparado para publicarse desde su raiz:

1. Subir los cambios a la rama `main` del repositorio de GitHub.
2. Abrir **Settings > Pages**.
3. En **Build and deployment**, elegir **Deploy from a branch**.
4. Seleccionar la rama `main`, carpeta `/ (root)`, y guardar.

GitHub mostrara la URL publica cuando termine el despliegue.

## Siguiente etapa: sincronizacion AWS

Para una persona anotando un partido, GitHub Pages y almacenamiento local son suficientes y no generan costo de infraestructura. Cuando sea necesario que varios telefonos vean o editen el mismo partido, la ampliacion recomendada es:

- Amazon API Gateway para la API HTTPS.
- AWS Lambda para validar y registrar eventos.
- Amazon DynamoDB para partidos y bitacoras.
- Amazon Cognito solo si se necesita acceso privado por usuario.
- API Gateway WebSocket para actualizaciones en vivo, si llega a ser necesario.

Antes de desplegar AWS conviene crear un AWS Budget y alarmas de facturacion. El backend no forma parte de este MVP.

## Estructura

```text
index.html              Interfaz y vistas
css/style.css           Diseno responsive
js/app.js               Eventos y renderizado
js/store.js             Estado y reglas del partido
data/roster.json        Plantel inicial del equipo
manifest.webmanifest    Instalacion como aplicacion
service-worker.js       Cache para uso sin conexion
icons/scorebook.svg     Icono de la aplicacion
```
