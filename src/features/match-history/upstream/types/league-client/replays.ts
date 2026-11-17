export interface ReplayMetadata extends ReplayDownloadProgress {}

// Event: /lol-replays/v1/metadata/{gameId}
export interface ReplayDownloadProgress {
  // checking 和 found 時, 這個數字不知道用途, 總之是一個很大的數字
  downloadProgress: number
  gameId: number
  state: 'checking' | 'found' | 'download' | 'downloading' | 'watch' | 'incompatible'
}

export interface ReplayConfiguration {
  gameVersion: string
  isInTournament: boolean
  isLoggedIn: boolean
  isPatching: boolean
  isPlayingGame: boolean
  isPlayingReplay: boolean
  isReplaysEnabled: boolean
  isReplaysForEndOfGameEnabled: boolean
  isReplaysForMatchHistoryEnabled: boolean
  minServerVersion: string
  minutesUntilReplayConsideredLost: number
}
