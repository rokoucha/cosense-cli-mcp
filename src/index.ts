import { loadEnv } from './config/env.js'
import { createApp } from './http/app.js'
import { registerGracefulShutdown } from './http/gracefulShutdown.js'

const env = loadEnv()
const app = createApp(env)

const server = app.listen(env.port, () => {
  console.log(
    JSON.stringify({
      event: 'server_started',
      port: env.port,
      issuer: env.issuer,
    }),
  )
})

registerGracefulShutdown(server, env.shutdownTimeoutMs)
