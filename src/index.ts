import { loadEnv } from './config/env.js'
import { createApp } from './http/app.js'

const env = loadEnv()
const app = createApp(env)

app.listen(env.port, () => {
  console.log(
    JSON.stringify({
      event: 'server_started',
      port: env.port,
      issuer: env.issuer,
    }),
  )
})
