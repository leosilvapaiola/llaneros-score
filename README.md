# Linea Viva

Aplicacion web movil para registrar la ofensiva de un equipo de softball. Guarda cada aparicion al bate y cada movimiento de corredores para poder reconstruir una entrada cuando la planilla oficial tenga errores.

## Funciones actuales

- Roster propio con numero, nombre y posicion.
- Lineup reordenable antes del partido.
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
6. Consultar **Bitacora** o deshacer la ultima jugada si hubo un error.
7. Descargar un respaldo JSON al terminar el partido.

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
manifest.webmanifest    Instalacion como aplicacion
service-worker.js       Cache para uso sin conexion
icons/scorebook.svg     Icono de la aplicacion
```
