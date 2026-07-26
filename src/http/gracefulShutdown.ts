import type { Server } from 'node:http'

type ShutdownSignal = 'SIGINT' | 'SIGTERM'

export function registerGracefulShutdown(
  server: Server,
  timeoutMs: number,
): void {
  let shuttingDown = false

  const shutdown = (signal: ShutdownSignal): void => {
    if (shuttingDown) {
      console.warn(JSON.stringify({ event: 'server_shutdown_forced', signal }))
      server.closeAllConnections()
      return
    }
    shuttingDown = true

    console.log(JSON.stringify({ event: 'server_shutdown_started', signal }))

    const forceCloseTimer = setTimeout(() => {
      console.warn(
        JSON.stringify({
          event: 'server_shutdown_timeout',
          timeoutMs,
        }),
      )
      server.closeAllConnections()
    }, timeoutMs)
    forceCloseTimer.unref()

    // 新規接続を止め、keep-alive中のアイドル接続はすぐ閉じる。処理中の
    // requestだけはtimeoutまで完了を待つ。
    server.close(() => {
      clearTimeout(forceCloseTimer)
      console.log(JSON.stringify({ event: 'server_shutdown_completed' }))
    })
    server.closeIdleConnections()
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
