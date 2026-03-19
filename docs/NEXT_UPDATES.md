- tsuki-Webkit:

Un framework ligero pensado para compilar de react a html, css y js para placas esp8266, esp32, etc. Pensado para crear paneles de control básicos y apis

este mismo se encontrará en /libs/tsuki-webkit, y estará escrito en rust completamente desade 0, sin usar otras librerías por detras de arduino.

Sus funciones tienen que ser

- Compilar jsx en html, css, y js
- Integrarlo en el paso de transpilación en el archivo cpp restante, antes de que se le pase a tsuki-flash
- Integración con el LSD, y con su propia pantalla en el lateral

INTEGRACION CON EL SANDBOX:

quiero que seaa por defecto una preview estática del componente, pero que si en el sandbox, antes de ejecutarse en el este mismo, se hace click sobre una placa compatible, y se marca la opción "simulate Webkit", se convertira en una preview completamente dinámica y funcional,

tambien quiero que en el aspecto de lo del LSD, al intentar importar otras librerias similares de arduino, recomienda pasar a tsuki-webkit

FUNCIONAMIENTO EN EL CODIGO:

// app.jsx
import { Api, Json, Serial } from tsuki-webkit


// Api: tools for create your api
// Json: Json parsing tools
// Serial: Tools for access serial functions from the web

export default app() {
    // logic

    return(
        <div>
            <h1><h1/>
        <div/>
    )
}

// tsuki-webkit.conf.json
{
    "Name": "",
    "Author": "",
    "Version": "",
    "Description": "",
    "app": {
        "Entrypoint": "app.jsx"
    }
}

// main.go ENTRYPOINT
package main

import (
  "arduino"
  "tsuki-webkit"
)

const app = tsuki-webkit.ApiInit()
// const tsuki-webkit = tsuki-webkit.WebInit()

const ledPin = 10
const interval = 500 // ms
const test = 20

func setup() {
  app.setup()
}

func loop() {
  app.tick()
}