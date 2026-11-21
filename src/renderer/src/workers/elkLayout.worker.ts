/// <reference lib="webworker" />
import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkGraphPayload, ElkLayoutNode } from '../board/elkDiagramLayout'

const elk = new ELK()

interface ElkWorkerRequest {
  reqId: number
  graph: ElkGraphPayload
}

self.onmessage = async (event: MessageEvent<ElkWorkerRequest>): Promise<void> => {
  const { reqId, graph } = event.data
  try {
    const layout = (await elk.layout(graph as Parameters<typeof elk.layout>[0])) as unknown as ElkLayoutNode
    self.postMessage({ reqId, ok: true, layout })
  } catch (err) {
    self.postMessage({
      reqId,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
