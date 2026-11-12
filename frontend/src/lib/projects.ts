import { useEffect, useState } from 'react'
import { api } from './api'
import { has, P } from './perms'
import type { Channel, Gathering, ProjectTag, StudioProject } from './types'
import { myChannelPerms, useStore } from '../store'

/** A project's stage in its studio's list, with the colour its pill wears. */
export const TAGS: { id: ProjectTag; label: string; cls: string }[] = [
  { id: 'writing', label: 'Writing', cls: 'bg-accent/20 text-accent' },
  { id: 'tracking', label: 'Tracking', cls: 'bg-danger/20 text-danger' },
  { id: 'mixing', label: 'Mixing', cls: 'bg-warn/20 text-warn' },
  { id: 'done', label: 'Done', cls: 'bg-success/20 text-success' },
]
export const tagOf = (id: ProjectTag | undefined) => TAGS.find((x) => x.id === id)

/** What I may do with a project (in its channel) or a studio (the channel holding them). */
export function projectRights(channel: Channel | undefined) {
  const s = useStore.getState()
  const me = s.user?.id
  const p = channel ? myChannelPerms(s, channel.id) : 0
  const engineer = !!me && !!channel?.engineer_ids?.includes(me)
  const artist = !!me && !!channel?.artist_ids?.includes(me)
  return {
    create: has(p, P.CREATE_PROJECTS),
    /** Rename, tag, archive and choose the band: the project's engineers and Manage Projects. */
    manage: engineer || has(p, P.MANAGE_PROJECTS),
    remove: has(p, P.DELETE_PROJECTS),
    /** In the band (or managing projects): edits the arrangement, in voice or not. */
    edit: engineer || artist || has(p, P.MANAGE_PROJECTS),
    engineer, artist,
  }
}

export const createProject = (studioId: string, body: { name: string; tag?: ProjectTag; bpm?: number; beats?: number }) => api.post<StudioProject>(`/channels/${studioId}/studio/projects`, body)
export const updateProject = (pid: string, patch: { name?: string; tag?: ProjectTag; archived?: boolean }) => api.patch<StudioProject>(`/studio/projects/${pid}`, patch)
export const deleteProject = (pid: string) => api.delete(`/studio/projects/${pid}`)
export const setBandRole = (room: string, uid: string, role: 'engineer' | 'artist' | 'audience') => api.put(`/channels/${room}/studio/role/${uid}`, { role })

export const startGathering = (room: string, title: string) => api.post<Gathering>(`/channels/${room}/studio/gatherings`, { title })
export const endGathering = (room: string, id: string) => api.post<Gathering>(`/channels/${room}/studio/gatherings/${id}/end`)

/** A project's sessions, newest first with the running one on top; kept current from STUDIO_GATHERING. */
export function useGatherings(room: string | undefined) {
  const [list, setList] = useState<Gathering[] | null>(null)
  useEffect(() => {
    if (!room) return
    let live = true
    const load = () => void api.get<Gathering[]>(`/channels/${room}/studio/gatherings`).then((l) => { if (live) setList(l) }).catch(() => {})
    load()
    const on = (e: Event) => { if ((e as CustomEvent).detail === room) load() }
    window.addEventListener('parley-studio-gathering', on)
    return () => { live = false; window.removeEventListener('parley-studio-gathering', on) }
  }, [room])
  return list
}
