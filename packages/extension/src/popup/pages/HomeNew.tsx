import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, RefreshCw, FileText, Loader2, Check, X, ExternalLink, ChevronDown, ChevronUp, Plus, Clock, Pencil } from 'lucide-react'
import { useSyncStore } from '../stores/sync'
import { PlatformGrid, type Platform as GridPlatform } from '../components/PlatformGrid'
import { SettingsDrawer } from '../components/SettingsDrawer'
import { cn } from '@/lib/utils'
import { trackPageView, trackFeatureDiscovery } from '../../lib/analytics'
import { createLogger } from '../../lib/logger'

const logger = createLogger('HomeNew')

export function HomeNew() {
  const navigate = useNavigate()
  const {
    status,
    article,
    platforms,
    selectedPlatforms,
    results,
    error,
    imageProgress,
    history,
    recovered,
    loadPlatforms,
    loadArticle,
    loadHistory,
    recoverSyncState,
    togglePlatform,
    selectAll,
    deselectAll,
    startSync,
    retryFailed,
    reset,
    checkRateLimit,
  } = useSyncStore()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [rateLimitWarning, setRateLimitWarning] = useState<string | null>(null)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [allPlatforms, setAllPlatforms] = useState<GridPlatform[]>([])
  const [refreshing, setRefreshing] = useState(false)

  // 加载数据（优先恢复同步状态）
  useEffect(() => {
    const init = async () => {
      // 先尝试恢复同步状态
      await recoverSyncState()
      // 再加载其他数据
      loadAllPlatforms()
      loadArticle()
      loadHistory()
    }
    init()
    // 追踪页面访问
    trackPageView('home').catch(() => {})
  }, [])

  // 加载所有平台（包括未登录的）
  const loadAllPlatforms = async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true)
    }
    try {
      const [response, cmsStorage] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'CHECK_ALL_AUTH', payload: { forceRefresh } }),
        chrome.storage.local.get('cmsAccounts'),
      ])

      const platforms: GridPlatform[] = []

      // DSL 平台（包括未登录的）
      if (response.platforms) {
        platforms.push(...response.platforms.map((p: any) => ({
          id: p.id,
          name: p.name,
          icon: p.icon,
          isAuthenticated: p.isAuthenticated,
          username: p.username,
          error: p.error,
          homepage: p.homepage,
        })))
      }

      // CMS 账户
      const cmsAccounts = cmsStorage.cmsAccounts || []
      platforms.push(...cmsAccounts.map((a: any) => ({
        id: a.id,
        name: a.name,
        icon: getCMSIcon(a.type),
        isAuthenticated: a.isConnected,
        username: a.username,
      })))

      setAllPlatforms(platforms)

      // 同时更新 store（用于同步）
      loadPlatforms()
    } catch (error) {
      logger.error('Failed to load platforms:', error)
    } finally {
      setRefreshing(false)
    }
  }

  // CMS 图标
  function getCMSIcon(type: string): string {
    switch (type) {
      case 'wordpress':
        return 'https://s.w.org/style/images/about/WordPress-logotype-simplified.png'
      case 'typecho':
        return '/assets/typecho.ico'
      case 'metaweblog':
        return 'https://www.cnblogs.com/favicon.ico'
      default:
        return '/assets/icon-48.png'
    }
  }

  // 选择状态
  const selectedSet = new Set(selectedPlatforms)
  const authenticatedPlatforms = allPlatforms.filter(p => p.isAuthenticated)

  // 切换全选
  const handleSelectAll = () => {
    if (selectedPlatforms.length === authenticatedPlatforms.length) {
      deselectAll()
    } else {
      selectAll()
    }
  }

  // 同步中的平台
  const syncingPlatforms = status === 'syncing'
    ? selectedPlatforms.filter(id => !results.find(r => r.platform === id))
    : []

  // 同步结果映射
  const resultMap = results.reduce((acc, r) => {
    acc[r.platform] = { success: r.success, url: r.postUrl }
    return acc
  }, {} as Record<string, { success: boolean; url?: string }>)

  // 成功/失败统计
  const successCount = results.filter(r => r.success).length
  const failedCount = results.filter(r => !r.success).length

  // 最近历史（最多3条）
  const recentHistory = history.slice(0, 3)

  return (
    <div className="flex flex-col h-[500px]">
      {/* 头部 */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <img src="/assets/icon-48.png" alt="Logo" className="w-6 h-6" />
          <h1 className="font-semibold">同步助手</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate('/add-cms')}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            title="添加站点"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate('/history')}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            title="同步历史"
          >
            <Clock className="w-4 h-4" />
          </button>
          <button
            onClick={() => loadAllPlatforms(true)}
            disabled={refreshing}
            className="p-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
            title="刷新平台状态"
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          </button>
          <button
            onClick={() => {
              setSettingsOpen(true)
              trackFeatureDiscovery('settings', 'header_icon').catch(() => {})
            }}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            title="设置"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 主内容 */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 文章预览 */}
        <div className="bg-muted/50 rounded-lg p-3">
          {article ? (
            <div className="flex gap-3">
              {article.cover && (
                <img
                  src={article.cover}
                  alt=""
                  className="w-16 h-16 rounded object-cover flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <h2 className="font-medium text-sm line-clamp-2">{article.title}</h2>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                  {article.summary || '已检测到文章内容'}
                </p>
              </div>
              <button
                onClick={async () => {
                  // 获取当前标签页
                  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
                  if (tab?.id) {
                    // 发送消息到 content script 打开编辑器
                    chrome.tabs.sendMessage(tab.id, {
                      type: 'OPEN_EDITOR',
                      platforms: allPlatforms,
                      selectedPlatforms: selectedPlatforms, // 传递已选中的平台
                    })
                    // 关闭 popup
                    window.close()
                  }
                }}
                className="flex-shrink-0 p-2 rounded-lg hover:bg-muted transition-colors"
                title="编辑文章"
              >
                <Pencil className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <FileText className="w-5 h-5 mr-2" />
              <span className="text-sm">请在文章页面打开扩展</span>
            </div>
          )}
        </div>

        {/* 平台选择 */}
        <PlatformGrid
          platforms={allPlatforms}
          selected={selectedSet}
          onToggle={togglePlatform}
          onSelectAll={handleSelectAll}
          loading={status === 'loading' && allPlatforms.length === 0}
          syncing={syncingPlatforms}
          results={resultMap}
        />

        {/* 错误提示 */}
        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* 最近同步 */}
        {recentHistory.length > 0 && status !== 'syncing' && status !== 'completed' && (
          <div className="space-y-2">
            <button
              onClick={() => setHistoryExpanded(!historyExpanded)}
              className="flex items-center justify-between w-full text-sm"
            >
              <span className="text-muted-foreground">最近同步</span>
              {historyExpanded ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>

            {historyExpanded && (
              <div className="space-y-2">
                {recentHistory.map(item => {
                  const success = item.results.filter(r => r.success).length
                  const total = item.results.length
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-2 bg-muted/30 rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(item.timestamp).toLocaleDateString()}
                        </p>
                      </div>
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded',
                        success === total ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                      )}>
                        {success}/{total}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* 底部操作栏 */}
      <footer className="flex-shrink-0 border-t bg-background">
        {/* 同步中进度面板 */}
        {status === 'syncing' && (
          <div className="px-4 pt-3 pb-2 bg-blue-50 dark:bg-blue-950/30 border-b space-y-2">
            {/* 进度头部 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  {syncingPlatforms.length > 0
                    ? `正在同步: ${allPlatforms.find(p => p.id === syncingPlatforms[0])?.name || ''}`
                    : '同步中...'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                  {results.length}/{selectedPlatforms.length}
                </span>
                <button
                  onClick={reset}
                  className="text-xs px-2 py-1 rounded bg-blue-200 dark:bg-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-300 dark:hover:bg-blue-700 transition-colors"
                  title="取消同步"
                >
                  取消
                </button>
              </div>
            </div>

            {/* 总进度条 */}
            <div className="h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${(results.length / selectedPlatforms.length) * 100}%` }}
              />
            </div>

            {/* 图片上传进度 */}
            {imageProgress && (
              <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
                <span>📷 上传图片</span>
                <div className="flex-1 h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-400 transition-all"
                    style={{ width: `${(imageProgress.current / imageProgress.total) * 100}%` }}
                  />
                </div>
                <span className="font-medium">{imageProgress.current}/{imageProgress.total}</span>
              </div>
            )}

            {/* 实时结果（最近3条） */}
            {results.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {results.slice(-3).map(r => (
                  <span
                    key={r.platform}
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs',
                      r.success
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    )}
                  >
                    {r.success ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    {r.platformName || r.platform}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 完成状态面板 */}
        {status === 'completed' && results.length > 0 && (
          <div className="px-4 pt-3 pb-2 bg-muted/50 border-b space-y-2 max-h-40 overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">同步完成</span>
              <span className="text-xs text-muted-foreground">
                {successCount} 成功 / {failedCount} 失败
              </span>
            </div>
            <div className="space-y-1">
              {results.map(r => (
                <div key={r.platform} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    {r.success ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <X className="w-4 h-4 text-red-500" />
                    )}
                    {r.platformName || r.platform}
                  </span>
                  {r.success && r.postUrl && (
                    <a
                      href={r.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-1 text-xs"
                    >
                      查看 <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {!r.success && r.error && (
                    <span className="text-xs text-red-500 truncate max-w-[100px]" title={r.error}>
                      {r.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 按钮区 */}
        <div className="p-4">
          {status === 'completed' ? (
            <div className="flex gap-2">
              {failedCount > 0 && (
                <button
                  onClick={retryFailed}
                  className="flex-1 py-3 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20"
                >
                  重试失败项
                </button>
              )}
              <button
                onClick={reset}
                className={cn(
                  'py-3 bg-muted text-foreground rounded-lg font-medium hover:bg-muted/80 transition-colors',
                  failedCount > 0 ? 'flex-1' : 'w-full'
                )}
              >
                完成
              </button>
            </div>
          ) : (
            <button
              onClick={async () => {
                // 检查频率，仅提醒不阻止
                const warning = await checkRateLimit()
                if (warning) {
                  setRateLimitWarning(warning)
                  // 3秒后自动关闭提醒
                  setTimeout(() => setRateLimitWarning(null), 3000)
                }
                // 无论有无警告都继续同步
                startSync()
              }}
              disabled={!article || selectedPlatforms.length === 0 || status === 'syncing'}
              className={cn(
                'w-full py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2',
                !article || selectedPlatforms.length === 0
                  ? 'bg-muted text-muted-foreground cursor-not-allowed'
                  : status === 'syncing'
                  ? 'bg-primary/70 text-primary-foreground cursor-wait'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              )}
            >
              {status === 'syncing' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  同步中 {results.length}/{selectedPlatforms.length}
                </>
              ) : (
                <>
                  🚀 同步到 {selectedPlatforms.length} 个平台
                </>
              )}
            </button>
          )}
        </div>
      </footer>

      {/* 设置抽屉 */}
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* 频率警告提示（非阻塞） */}
      {rateLimitWarning && (
        <div className="fixed top-2 left-2 right-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="bg-yellow-50 dark:bg-yellow-950/50 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 shadow-lg flex items-start gap-2">
            <span className="text-lg flex-shrink-0">⚠️</span>
            <p className="text-sm text-yellow-800 dark:text-yellow-200 flex-1">{rateLimitWarning}</p>
            <button
              onClick={() => setRateLimitWarning(null)}
              className="text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200 flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
