import { CloseOutlined, PushpinFilled, PushpinOutlined, SearchOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { matchHistoryApi } from '../api'
import { profileIconPath } from '../assets/gameData'
import { errorCode, type SearchHistoryItem } from '../contracts'
import type { SummonerInfo } from '../upstream/types/league-client/summoner'
import { GameImage, Spinner, useMh } from './primitives'

/** Parses `name#tag` (also full-width ＃). Returns null when either part is missing. */
export function parseRiotId(input: string) {
  const [gameName, ...rest] = input.trim().split(/[#＃]/)
  const tagLine = rest.join('#').trim()
  return gameName.trim() && tagLine ? { gameName: gameName.trim(), tagLine } : null
}

export function PlayerSearch({ scope, platformId, keepHistory, onOpen, autoFocus }: {
  scope: string
  platformId: string
  keepHistory: boolean
  onOpen: (player: { puuid: string; gameName?: string; tagLine?: string; profileIconId?: number }) => void
  autoFocus?: boolean
}) {
  const { t } = useMh()
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [results, setResults] = useState<SummonerInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<SearchHistoryItem[]>([])

  useEffect(() => {
    matchHistoryApi.searchHistory().then(setHistory, () => setHistory([]))
  }, [])

  const open = (player: { puuid: string; gameName?: string; tagLine?: string; profileIconId?: number }) => {
    onOpen(player)
    if (keepHistory && player.gameName) {
      matchHistoryApi
        .updateSearchHistory('save', { puuid: player.puuid, platformId, gameName: player.gameName, tagLine: player.tagLine ?? '', profileIconId: player.profileIconId ?? null })
        .then(setHistory, () => {})
    }
  }

  const submit = async () => {
    const riotId = parseRiotId(input)
    if (!riotId) {
      setStatus('error')
      setError('format')
      return
    }
    setStatus('loading')
    setError(null)
    try {
      const found = (await matchHistoryApi.search(scope, riotId.gameName, riotId.tagLine)).filter(item => item?.puuid)
      setResults(found)
      setStatus('done')
    } catch (reason) {
      setResults([])
      setStatus('error')
      setError(errorCode(reason))
    }
  }

  const update = (action: 'delete' | 'pin', item: SearchHistoryItem) => matchHistoryApi.updateSearchHistory(action, item).then(setHistory, () => {})
  return (
    <div className="mh-search flex w-full max-w-120 flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={event => {
          event.preventDefault()
          void submit()
        }}
      >
        <input
          className="mh-input flex-1"
          value={input}
          autoFocus={autoFocus}
          maxLength={48}
          onChange={event => setInput(event.target.value)}
          placeholder={t('playerSearch.placeholder')}
          aria-label={t('playerSearch.title')}
        />
        <button type="submit" className="mh-button primary px-3" disabled={status === 'loading'} aria-label={t('playerSearch.search')}>
          {status === 'loading' ? <Spinner size={14} /> : <SearchOutlined />}
        </button>
      </form>
      {status === 'error' && (
        <div className="text-xs text-red-600 dark:text-red-300">
          {error === 'format'
            ? t('playerSearch.formatHint')
            : error === 'Unsupported' || error === 'NotFound'
              ? t('playerSearch.notFound')
              : t('playerSearch.failed', { code: error })}
        </div>
      )}
      {status === 'done' && results.length === 0 && <div className="text-xs text-black/60 dark:text-white/60">{t('playerSearch.notFound')}</div>}
      {results.length > 0 && (
        <div className="flex flex-col gap-1">
          {results.map(result => (
            <button
              key={result.puuid}
              type="button"
              className="mh-list-item"
              onClick={() => open({ puuid: result.puuid, gameName: result.gameName, tagLine: result.tagLine, profileIconId: result.profileIconId })}
            >
              <GameImage path={profileIconPath(result.profileIconId)} className="size-8 rounded" />
              <span className="flex flex-col text-left">
                <span className="text-sm font-bold">
                  {result.gameName}
                  <span className="ml-1 font-normal text-black/60 dark:text-white/60">#{result.tagLine}</span>
                </span>
                <span className="text-xs text-black/60 dark:text-white/60">{t('playerSearch.level', { level: result.summonerLevel })}{result.privacy === 'PRIVATE' ? ` · ${t('playerTabs.profilePrivacy.private')}` : ''}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {keepHistory && history.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-xs text-black/60 dark:text-white/60">{t('playerSearch.history')}</div>
          {history.map(item => (
            <div key={`${item.platformId}|${item.puuid}`} className="mh-list-item">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left text-inherit" disabled={item.platformId !== platformId} onClick={() => open({ puuid: item.puuid, gameName: item.gameName, tagLine: item.tagLine, profileIconId: item.profileIconId ?? undefined })}>
                <GameImage path={profileIconPath(item.profileIconId ?? undefined)} className="size-6 rounded" />
                <span className="truncate text-sm">
                  {item.gameName}
                  <span className="ml-1 text-xs text-black/60 dark:text-white/60">#{item.tagLine}</span>
                </span>
                {item.platformId !== platformId && <span className="text-[11px] text-black/50 dark:text-white/50">{item.platformId}</span>}
              </button>
              <button type="button" className="mh-icon-button" aria-label={t('playerSearch.pin')} aria-pressed={!!item.isPinned} onClick={() => void update('pin', item)}>
                {item.isPinned ? <PushpinFilled /> : <PushpinOutlined />}
              </button>
              <button type="button" className="mh-icon-button" aria-label={t('playerSearch.remove')} onClick={() => void update('delete', item)}>
                <CloseOutlined />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
