/// <reference types="vite/client" />

import type { CollaboratorApi } from '@shared/types'

declare global {
  interface Window {
    collaborator: CollaboratorApi
  }
}

export {}
