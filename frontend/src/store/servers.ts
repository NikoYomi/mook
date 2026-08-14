import { create } from 'zustand'
import { api, Server, ServerInput } from '../api/client'

interface ServersState {
  servers: Server[]
  loading: boolean
  load: () => Promise<void>
  create: (s: ServerInput) => Promise<void>
  update: (id: number, s: ServerInput) => Promise<void>
  remove: (id: number) => Promise<void>
  reorder: (ids: number[]) => Promise<void>
}

export const useServers = create<ServersState>((set, get) => ({
  servers: [],
  loading: false,
  async load() {
    set({ loading: true })
    try {
      const servers = await api.listServers()
      set({ servers })
    } finally {
      set({ loading: false })
    }
  },
  async create(s) {
    await api.createServer(s)
    await get().load()
  },
  async update(id, s) {
    await api.updateServer(id, s)
    await get().load()
  },
  async remove(id) {
    await api.deleteServer(id)
    await get().load()
  },
  async reorder(ids) {
    await api.reorderServers(ids)
    await get().load()
  },
}))
