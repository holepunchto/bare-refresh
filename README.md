# bare-refresh

Refresh a running Bare application without restarting it. A host runs the application from a bundle and builds its module graph again whenever the server sends it an update. Changed modules are evaluated again in place where they accept it, and the whole graph is reloaded where they don't. Data put on `refresh.data` survives both.

```
npm i bare-refresh
```

## Usage

The host runs on the device, usually from the generated entry of a development build:

```js
const Refresh = require('bare-refresh')

const refresh = new Refresh(bundle)

await refresh.start()

refresh.connect(stream)
```

The server runs wherever the application is packed:

```js
const RefreshServer = require('bare-refresh/server')

const server = new RefreshServer(async () => {
  // Pack the application and return the bundle
})

server.connect(stream)

// Whenever the sources change
await server.update()
```

Inside the application, `require('bare-refresh')` returns the host instead of this module:

```js
const refresh = require('bare-refresh')

const hot = refresh.hot(module)

hot.accept()

refresh.dispose(() => window.close())
```

Outside a host, the same calls do nothing, so an application can make them unconditionally.

## License

Apache-2.0
