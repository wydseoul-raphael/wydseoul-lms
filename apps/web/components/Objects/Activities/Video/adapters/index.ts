import type { VideoProvider } from '../videoContent'
import type { PlayerAdapter } from './types'
import { YouTubeAdapter } from './YouTubeAdapter'
import { VideoJsAdapter } from './VideoJsAdapter'
import { VimeoAdapter } from './VimeoAdapter'

export * from './types'
export { YouTubeAdapter, VideoJsAdapter, VimeoAdapter }

export function createAdapter(provider: VideoProvider): PlayerAdapter {
  switch (provider) {
    case 'hosted':
      return new VideoJsAdapter()
    case 'vimeo':
      return new VimeoAdapter()
    default:
      return new YouTubeAdapter()
  }
}
