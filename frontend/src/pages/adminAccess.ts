import { createContext, useContext } from 'react'

/** What the signed-in admin may do (GET /admin/access). The server checks every request; this only hides what would be refused. */
export interface AdminAccess { roles: string[]; perms: string[]; all_roles: string[] }
export const AccessCtx = createContext<AdminAccess | null>(null)
export const useAccess = () => useContext(AccessCtx)
export const can = (a: AdminAccess | null, ...perms: string[]) => !!a && perms.some((p) => a.perms.includes(p))
