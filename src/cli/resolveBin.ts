import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

let cachedBinPath: string | undefined

export function resolveCosenseBin(): string {
  if (cachedBinPath) {
    return cachedBinPath
  }
  const require = createRequire(import.meta.url)
  const packageJsonPath = require.resolve('@helpfeel/cosense-cli/package.json')
  cachedBinPath = join(dirname(packageJsonPath), 'bin', 'cosense')
  return cachedBinPath
}
