import { describe, expect, it } from 'vitest'
import { extractRpcLogFields } from './logging.js'

describe('extractRpcLogFields', () => {
  it('extracts a tools/call method and tool name without arguments', () => {
    expect(
      extractRpcLogFields({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'submitEdit',
          arguments: { projectUrl: 'secret', previewId: 'secret' },
        },
      }),
    ).toEqual({ rpcMethod: 'tools/call', rpcToolName: 'submitEdit' })
  })

  it('extracts methods that do not name a tool', () => {
    expect(extractRpcLogFields({ method: 'tools/list' })).toEqual({
      rpcMethod: 'tools/list',
    })
  })

  it('ignores malformed and batch bodies', () => {
    expect(extractRpcLogFields(null)).toEqual({})
    expect(extractRpcLogFields([{ method: 'tools/list' }])).toEqual({})
  })
})
