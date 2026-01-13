import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Check, Loader2, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createLogger } from '../lib/logger'

const logger = createLogger('Editor')

interface Article {
  title: string
  content: string
  cover?: string
  url?: string
}

interface Platform {
  id: string
  name: string
  icon: string
  isAuthenticated: boolean
  username?: string
}

interface SyncResult {
  platform: string
  platformName?: string
  success: boolean
  postUrl?: string
  error?: string
}

// 同步阶段类型
type SyncStage = 'starting' | 'uploading_images' | 'saving' | 'completed' | 'failed'

// 平台同步详细进度
interface PlatformProgress {
  platform: string
  platformName: string
  stage: SyncStage
  imageProgress?: { current: number; total: number }
  error?: string
}

type SyncStatus = 'idle' | 'syncing' | 'completed'

// Storage key for selected platforms (same as popup)
const SELECTED_PLATFORMS_KEY = 'selectedPlatforms'

// 保存选中的平台到 storage
function saveSelectedPlatforms(platformIds: string[]) {
  chrome.storage.local.set({ [SELECTED_PLATFORMS_KEY]: platformIds }).catch((e) => {
    logger.error('Failed to save selected platforms:', e)
  })
}

export function EditorApp() {
  const [article, setArticle] = useState<Article | null>(null)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [results, setResults] = useState<SyncResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [rateLimitWarning, setRateLimitWarning] = useState<string | null>(null)
  const [platformProgress, setPlatformProgress] = useState<Map<string, PlatformProgress>>(new Map())
  const [currentSyncId, setCurrentSyncId] = useState<string | null>(null)
  const currentSyncIdRef = useRef<string | null>(null)

  // 保持 ref 与 state 同步
  useEffect(() => {
    currentSyncIdRef.current = currentSyncId
  }, [currentSyncId])

  const titleRef = useRef<HTMLHeadingElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // 接收来自父窗口的消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data

        // 如果消息带有 syncId，需要匹配当前的 syncId
        if (data.syncId) {
          // 如果当前没有 syncId，保存这个 syncId（新同步开始）
          if (!currentSyncIdRef.current) {
            setCurrentSyncId(data.syncId)
          } else if (data.syncId !== currentSyncIdRef.current) {
            // 如果已有 syncId 且不匹配，忽略消息
            logger.debug('Ignoring message with different syncId:', data.syncId, 'current:', currentSyncIdRef.current)
            return
          }
        }

        logger.debug('Received message:', data)

        if (data.type === 'ARTICLE_DATA') {
          setArticle(data.article)
          // 设置初始内容
          if (contentRef.current && data.article.content) {
            contentRef.current.innerHTML = data.article.content
          }
        } else if (data.type === 'PLATFORMS_DATA') {
          setPlatforms(data.platforms)
          // 使用传递的已选中平台，如果没有则从 storage 读取
          if (data.selectedPlatformIds && data.selectedPlatformIds.length > 0) {
            setSelectedPlatforms(new Set(data.selectedPlatformIds))
            saveSelectedPlatforms(data.selectedPlatformIds)
          } else {
            // 从 storage 读取上次选中的平台
            chrome.storage.local.get(SELECTED_PLATFORMS_KEY).then((result) => {
              const storedPlatforms = result[SELECTED_PLATFORMS_KEY] as string[] | undefined
              const authenticated = data.platforms.filter((p: Platform) => p.isAuthenticated)
              const authenticatedIds = authenticated.map((p: Platform) => p.id)
              const authenticatedSet = new Set(authenticatedIds)

              let selected: string[]
              if (storedPlatforms && storedPlatforms.length > 0) {
                // 过滤掉未登录的平台
                selected = storedPlatforms.filter(id => authenticatedSet.has(id))
              } else {
                // 默认选中所有已登录平台
                selected = authenticatedIds
              }

              if (selected.length === 0) {
                // 如果过滤后为空，选中所有已登录平台
                selected = authenticatedIds
              }

              setSelectedPlatforms(new Set(selected))
            }).catch((e) => {
              logger.error('Failed to load selected platforms:', e)
              // 失败时默认选中所有已登录平台
              const authenticated = data.platforms.filter((p: Platform) => p.isAuthenticated)
              setSelectedPlatforms(new Set(authenticated.map((p: Platform) => p.id)))
            })
          }
        } else if (data.type === 'SYNC_PROGRESS') {
          if (data.result) {
            setResults(prev => [...prev, data.result])
          }
        } else if (data.type === 'SYNC_DETAIL_PROGRESS') {
          // 更新平台详细进度
          const progress = data.progress
          if (progress?.platform) {
            setPlatformProgress(prev => {
              const next = new Map(prev)
              next.set(progress.platform, progress)
              return next
            })
          }
        } else if (data.type === 'SYNC_COMPLETE') {
          setStatus('completed')
          // 显示频率限制警告（如果有）
          if (data.rateLimitWarning) {
            setRateLimitWarning(data.rateLimitWarning)
            // 8秒后自动关闭
            setTimeout(() => setRateLimitWarning(null), 8000)
          }
        } else if (data.type === 'SYNC_ERROR') {
          setError(data.error)
          setStatus('idle')
        }
      } catch (e) {
        logger.error('Failed to parse message:', e)
      }
    }

    window.addEventListener('message', handleMessage)

    // 通知父窗口已准备好
    window.parent.postMessage(JSON.stringify({ type: 'EDITOR_READY' }), '*')

    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // 关闭编辑器
  const handleClose = useCallback(() => {
    window.parent.postMessage(JSON.stringify({ type: 'CLOSE_EDITOR' }), '*')
  }, [])

  // 切换平台选中状态
  const togglePlatform = (id: string) => {
    setSelectedPlatforms(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      // 保存到 storage，与 popup 同步
      saveSelectedPlatforms(Array.from(next))
      return next
    })
  }

  // 开始同步
  const handleSync = () => {
    if (!article || selectedPlatforms.size === 0) return

    // 获取编辑后的内容
    const editedArticle = {
      ...article,
      title: titleRef.current?.innerText || article.title,
      content: contentRef.current?.innerHTML || article.content,
    }

    // 生成 syncId（在发送消息前设置，以便立即过滤消息）
    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setCurrentSyncId(syncId)

    setStatus('syncing')
    setResults([])
    setError(null)
    setPlatformProgress(new Map())

    // 发送同步请求到父窗口（带上 syncId）
    window.parent.postMessage(JSON.stringify({
      type: 'START_SYNC',
      article: editedArticle,
      platforms: Array.from(selectedPlatforms),
      syncId,
    }), '*')
  }

  // 重试失败项
  const handleRetry = () => {
    const failedPlatforms = results.filter(r => !r.success).map(r => r.platform)
    if (failedPlatforms.length === 0) return

    const editedArticle = {
      ...article!,
      title: titleRef.current?.innerText || article!.title,
      content: contentRef.current?.innerHTML || article!.content,
    }

    // 生成新的 syncId
    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    setCurrentSyncId(syncId)

    setStatus('syncing')
    setResults(prev => prev.filter(r => r.success))
    setPlatformProgress(new Map()) // 清空进度

    window.parent.postMessage(JSON.stringify({
      type: 'START_SYNC',
      article: editedArticle,
      platforms: failedPlatforms,
      syncId,
    }), '*')
  }

  const authenticatedPlatforms = platforms.filter(p => p.isAuthenticated)
  const successCount = results.filter(r => r.success).length
  const failedCount = results.filter(r => !r.success).length

  if (!article) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto" />
          <p className="mt-2 text-gray-500">加载文章中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部工具栏 */}
      <header className="fixed top-0 left-0 right-0 bg-white border-b shadow-sm z-50">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src={chrome.runtime.getURL('assets/icon-48.png')} alt="Logo" className="w-6 h-6" />
            <span className="font-medium text-gray-700">同步助手 - 编辑模式</span>
          </div>

          <div className="flex items-center gap-2">
            {status === 'idle' && (
              <button
                onClick={handleSync}
                disabled={selectedPlatforms.size === 0}
                className={cn(
                  'px-4 py-2 rounded-lg font-medium transition-colors',
                  selectedPlatforms.size > 0
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                )}
              >
                同步到 {selectedPlatforms.size} 个平台
              </button>
            )}

            {status === 'syncing' && (
              <div className="flex items-center gap-2">
                <span className="px-4 py-2 rounded-lg bg-blue-400 text-white flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  同步中 {results.length}/{selectedPlatforms.size}
                </span>
                <button
                  onClick={() => {
                    setStatus('idle')
                    setResults([])
                    setError(null)
                  }}
                  className="px-3 py-2 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors text-sm"
                >
                  取消
                </button>
              </div>
            )}

            {status === 'completed' && (
              <div className="flex items-center gap-2">
                {failedCount > 0 && (
                  <button
                    onClick={handleRetry}
                    className="px-4 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600"
                  >
                    重试失败 ({failedCount})
                  </button>
                )}
                <span className="text-sm text-gray-500">
                  {successCount} 成功 / {failedCount} 失败
                </span>
                <button
                  onClick={() => {
                    setStatus('idle')
                    setResults([])
                    setPlatformProgress(new Map())
                    setCurrentSyncId(null)
                  }}
                  className="px-4 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600"
                >
                  完成
                </button>
              </div>
            )}

            <button
              onClick={handleClose}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              title="关闭"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* 平台选择栏 */}
        <div className="px-6 py-2 border-t bg-gray-50 flex items-center gap-2 overflow-x-auto">
          <span className="text-sm text-gray-500 flex-shrink-0">选择平台:</span>
          {authenticatedPlatforms.map(platform => {
            const isSelected = selectedPlatforms.has(platform.id)
            const result = results.find(r => r.platform === platform.id)

            return (
              <button
                key={platform.id}
                onClick={() => togglePlatform(platform.id)}
                disabled={status === 'syncing'}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all flex-shrink-0',
                  isSelected
                    ? 'bg-blue-100 text-blue-700 border-2 border-blue-300'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300',
                  status === 'syncing' && 'opacity-50 cursor-not-allowed'
                )}
              >
                <img src={platform.icon} alt="" className="w-4 h-4 rounded" />
                <span>{platform.name}</span>
                {result && (
                  result.success ? (
                    <Check className="w-3 h-3 text-green-500" />
                  ) : (
                    <X className="w-3 h-3 text-red-500" />
                  )
                )}
              </button>
            )
          })}
        </div>
      </header>

      {/* 频率限制警告 */}
      {rateLimitWarning && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 shadow-lg flex items-center gap-2 max-w-md">
            <span className="text-lg flex-shrink-0">⚠️</span>
            <p className="text-sm text-yellow-800 flex-1">{rateLimitWarning}</p>
            <button
              onClick={() => setRateLimitWarning(null)}
              className="text-yellow-600 hover:text-yellow-800 flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 文章内容区 */}
      <main className="pt-28 pb-16">
        <article className="w-full max-w-4xl mx-auto bg-white shadow-sm px-12 py-10" style={{ minHeight: 'calc(100vh - 7rem)' }}>
          {/* 封面图 */}
          {article.cover && (
            <img
              src={article.cover}
              alt=""
              className="w-full max-h-80 object-cover mb-8"
            />
          )}

          {/* 标题 - 可编辑 */}
          <h1
            ref={titleRef}
            contentEditable
            suppressContentEditableWarning
            className="text-3xl font-bold text-gray-900 mb-8 outline-none focus:bg-blue-50 rounded px-2 -mx-2 leading-tight"
          >
            {article.title}
          </h1>

          {/* 内容 - 可编辑 */}
          <div
            ref={contentRef}
            contentEditable
            suppressContentEditableWarning
            className="outline-none focus:bg-blue-50/50 rounded article-content"
            style={{
              fontSize: '16px',
              lineHeight: '1.8',
              color: '#333',
            }}
            dangerouslySetInnerHTML={{ __html: article.content }}
          />
          <style>{`
            .article-content p { margin-bottom: 1em; }
            .article-content h1 { font-size: 2em; font-weight: bold; margin: 1em 0 0.5em; }
            .article-content h2 { font-size: 1.5em; font-weight: bold; margin: 1em 0 0.5em; }
            .article-content h3 { font-size: 1.25em; font-weight: 600; margin: 0.8em 0 0.4em; }
            .article-content img { max-width: 100%; height: auto; margin: 1em 0; display: block; }
            .article-content pre { background: #f5f5f5; padding: 1em; border-radius: 6px; overflow-x: auto; margin: 1em 0; font-size: 14px; }
            .article-content code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
            .article-content pre code { background: none; padding: 0; }
            .article-content blockquote { border-left: 4px solid #ddd; padding-left: 1em; margin: 1em 0; color: #666; font-style: italic; }
            .article-content ul { list-style: disc; padding-left: 2em; margin: 1em 0; }
            .article-content ol { list-style: decimal; padding-left: 2em; margin: 1em 0; }
            .article-content li { margin-bottom: 0.5em; }
            .article-content a { color: #2563eb; text-decoration: underline; }
            .article-content table { border-collapse: collapse; width: 100%; margin: 1em 0; }
            .article-content th, .article-content td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
            .article-content th { background: #f5f5f5; font-weight: 600; }
            .article-content hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
            .article-content strong { font-weight: 600; }
            .article-content em { font-style: italic; }
          `}</style>
        </article>
      </main>

      {/* 同步进度/结果浮窗 */}
      {(status === 'syncing' || results.length > 0) && (
        <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg border p-4 w-80 max-h-80 overflow-y-auto z-50">
          <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
            {status === 'syncing' && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
            {status === 'syncing' ? '同步中' : '同步结果'}
            <span className="text-sm font-normal text-gray-500">
              {results.length}/{selectedPlatforms.size}
            </span>
          </h3>
          <div className="space-y-2">
            {Array.from(selectedPlatforms).map(platformId => {
              const platform = platforms.find(p => p.id === platformId)
              const result = results.find(r => r.platform === platformId)
              const progress = platformProgress.get(platformId)

              // 获取阶段文本
              const getStageText = (p: PlatformProgress) => {
                switch (p.stage) {
                  case 'starting': return '准备中...'
                  case 'uploading_images':
                    return p.imageProgress
                      ? `上传图片 ${p.imageProgress.current}/${p.imageProgress.total}`
                      : '上传图片...'
                  case 'saving': return '保存文章...'
                  case 'completed': return '完成'
                  case 'failed': return p.error || '失败'
                  default: return '等待中'
                }
              }

              if (result) {
                // 已完成
                return (
                  <div key={platformId} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      {result.success ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <X className="w-4 h-4 text-red-500" />
                      )}
                      {platform?.name || platformId}
                    </span>
                    {result.success && result.postUrl && (
                      <a
                        href={result.postUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline flex items-center gap-1"
                      >
                        查看 <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {!result.success && result.error && (
                      <span className="text-red-500 truncate max-w-[120px]" title={result.error}>
                        {result.error}
                      </span>
                    )}
                  </div>
                )
              }

              if (progress) {
                // 进行中
                return (
                  <div key={platformId} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                      {platform?.name || platformId}
                    </span>
                    <span className="text-blue-600 text-xs">
                      {getStageText(progress)}
                    </span>
                  </div>
                )
              }

              // 等待中
              return (
                <div key={platformId} className="flex items-center justify-between text-sm text-gray-400">
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full border border-gray-300" />
                    {platform?.name || platformId}
                  </span>
                  <span className="text-xs">等待中</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="fixed bottom-4 left-4 bg-red-50 border border-red-200 rounded-lg p-4 max-w-sm z-50">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-red-500 hover:underline text-sm"
          >
            关闭
          </button>
        </div>
      )}
    </div>
  )
}
