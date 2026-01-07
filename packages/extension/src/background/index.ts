import {
  initAdapters,
  checkAllPlatformsAuth,
  checkPlatformAuth,
  syncToMultiplePlatforms,
  getAllPlatformMetas,
  cancelSync,
} from '../adapters'
import * as wordpressAdapter from '../adapters/cms/wordpress'
import * as metaweblogAdapter from '../adapters/cms/metaweblog'
import { startMcpClient, stopMcpClient, getMcpStatus } from '../mcp/client'
import { createLogger } from '../lib/logger'
import {
  trackSyncStart,
  trackPlatformSync,
  trackSyncComplete,
  trackInstall,
  trackCmsSync,
  trackFeatureUse,
  trackArticleExtract,
  trackMcpUsage,
  trackCmsManagement,
  recordInstallTimestamp,
  inferErrorType,
  trackMilestone,
  trackGrowthMetrics,
} from '../lib/analytics'

const logger = createLogger('Background')

// CMS 类型
type CMSType = 'wordpress' | 'typecho' | 'metaweblog'

// 同步状态类型
interface ActiveSyncState {
  status: 'syncing' | 'completed'
  article: {
    title: string
    cover?: string
    content?: string
    html?: string
    markdown?: string
  } | null
  selectedPlatforms: string[]
  results: SyncResult[]
  startTime: number
}

const SYNC_STATE_KEY = 'activeSyncState'

// Badge 颜色
const BADGE_COLORS = {
  syncing: '#3B82F6',   // 蓝色
  success: '#22C55E',   // 绿色
  error: '#EF4444',     // 红色
  partial: '#F59E0B',   // 橙色
}

/**
 * 更新扩展 Badge
 */
async function updateBadge(state: ActiveSyncState | null) {
  if (!state) {
    await chrome.action.setBadgeText({ text: '' })
    return
  }

  const completed = state.results.length
  const total = state.selectedPlatforms.length

  if (state.status === 'syncing') {
    await chrome.action.setBadgeText({ text: `${completed}/${total}` })
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.syncing })
  } else if (state.status === 'completed') {
    const successCount = state.results.filter(r => r.success).length
    const failedCount = total - successCount

    if (failedCount === 0) {
      await chrome.action.setBadgeText({ text: '✓' })
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.success })
    } else if (successCount === 0) {
      await chrome.action.setBadgeText({ text: '!' })
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.error })
    } else {
      await chrome.action.setBadgeText({ text: `${successCount}` })
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.partial })
    }

    // 8秒后清除 badge
    setTimeout(async () => {
      const storage = await chrome.storage.local.get(SYNC_STATE_KEY)
      if (storage[SYNC_STATE_KEY]?.status === 'completed') {
        await chrome.action.setBadgeText({ text: '' })
      }
    }, 8000)
  }
}

/**
 * 保存同步状态
 */
async function saveSyncState(state: ActiveSyncState) {
  await chrome.storage.local.set({ [SYNC_STATE_KEY]: state })
  await updateBadge(state)
}

/**
 * 清除同步状态
 */
async function clearSyncState() {
  await chrome.storage.local.remove(SYNC_STATE_KEY)
  await chrome.action.setBadgeText({ text: '' })
}

// 消息类型
type MessageAction =
  | { type: 'GET_PLATFORMS' }
  | { type: 'CHECK_ALL_AUTH'; payload?: { forceRefresh?: boolean } }
  | { type: 'CHECK_AUTH'; payload: { platformId: string } }
  | { type: 'SYNC_ARTICLE'; payload: { article: any; platforms: string[]; skipHistory?: boolean; source?: string } }
  | { type: 'OPEN_SYNC_PAGE'; path?: string }
  | { type: 'TEST_CMS_CONNECTION'; payload: { type: CMSType; url: string; username: string; password: string } }
  | { type: 'SYNC_TO_CMS'; payload: { accountId: string; article: any } }
  | { type: 'MCP_ENABLE' }
  | { type: 'MCP_DISABLE' }
  | { type: 'MCP_STATUS' }
  | { type: 'TRACK_ARTICLE_EXTRACT'; payload: { source: string; success: boolean; hasTitle?: boolean; hasContent?: boolean; hasCover?: boolean; contentLength?: number } }
  | { type: 'GET_SYNC_STATE' }
  | { type: 'CLEAR_SYNC_STATE' }
  | { type: 'CANCEL_SYNC' }
  | { type: 'START_SYNC_FROM_EDITOR'; article: any; platforms: string[] }

/**
 * 消息处理
 */
chrome.runtime.onMessage.addListener((message: MessageAction, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => sendResponse({ error: error.message }))

  return true // 异步响应
})

async function handleMessage(message: MessageAction, sender?: chrome.runtime.MessageSender) {
  switch (message.type) {
    case 'GET_PLATFORMS': {
      await initAdapters()
      const platforms = getAllPlatformMetas()
      return { platforms }
    }

    case 'CHECK_ALL_AUTH': {
      const forceRefresh = message.payload?.forceRefresh ?? false
      const platforms = await checkAllPlatformsAuth(forceRefresh)
      return { platforms }
    }

    case 'CHECK_AUTH': {
      const { platformId } = message.payload
      const auth = await checkPlatformAuth(platformId)
      return { auth }
    }

    case 'SYNC_ARTICLE': {
      const { article, platforms, skipHistory, source = 'popup' } = message.payload
      const allPlatformMetas = getAllPlatformMetas()

      // 初始化同步状态（保存完整文章信息）
      const syncState: ActiveSyncState = {
        status: 'syncing',
        article: {
          title: article.title,
          cover: article.cover,
          content: article.content,
          html: article.html,
          markdown: article.markdown,
        },
        selectedPlatforms: platforms,
        results: [],
        startTime: Date.now(),
      }
      await saveSyncState(syncState)

      const results = await syncToMultiplePlatforms(platforms, article, {
        onResult: (result) => {
          // 更新持久化状态
          syncState.results.push({
            ...result,
            platformName: allPlatformMetas.find(p => p.id === result.platform)?.name || result.platform,
          })
          saveSyncState(syncState).catch(() => {})

          // 发送同步进度通知到 popup
          chrome.runtime.sendMessage({
            type: 'SYNC_PROGRESS',
            payload: { result },
          }).catch(() => {
            // popup 可能未打开，忽略
          })
        },
        onImageProgress: (platform, current, total) => {
          // 发送图片上传进度通知到 popup
          chrome.runtime.sendMessage({
            type: 'IMAGE_PROGRESS',
            payload: { platform, current, total },
          }).catch(() => {
            // popup 可能未打开，忽略
          })
        },
      }, source)

      // 更新为完成状态
      syncState.status = 'completed'
      syncState.results = results.map(r => ({
        ...r,
        platformName: allPlatformMetas.find(p => p.id === r.platform)?.name || r.platform,
      }))
      await saveSyncState(syncState)

      // 保存到历史记录（popup 自己处理历史，跳过）
      if (!skipHistory) {
        await saveToHistory(article, results, allPlatformMetas)
      }

      return { results }
    }

    case 'OPEN_SYNC_PAGE': {
      // 获取扩展的 popup 页面 URL (支持 hash 路由)
      const path = message.path || ''
      const popupUrl = chrome.runtime.getURL('src/popup/index.html') + (path ? `#${path}` : '')

      // 窗口尺寸
      const width = 396
      const height = 560

      // 获取当前窗口信息以计算居中位置
      const currentWindow = await chrome.windows.getCurrent()
      const left = currentWindow.left !== undefined && currentWindow.width !== undefined
        ? Math.round(currentWindow.left + (currentWindow.width - width) / 2)
        : undefined
      const top = currentWindow.top !== undefined && currentWindow.height !== undefined
        ? Math.round(currentWindow.top + (currentWindow.height - height) / 2)
        : undefined

      // 在新窗口中打开同步页面（居中显示）
      await chrome.windows.create({
        url: popupUrl,
        type: 'popup',
        width,
        height,
        left,
        top,
        focused: true,
      })
      return { success: true }
    }

    case 'TEST_CMS_CONNECTION': {
      const { type, url, username, password } = message.payload
      const credentials = { url, username, password }

      try {
        let result
        switch (type) {
          case 'wordpress':
            result = await wordpressAdapter.testConnection(credentials)
            break
          case 'typecho':
            result = await metaweblogAdapter.testTypechoConnection(credentials)
            break
          case 'metaweblog':
            result = await metaweblogAdapter.testConnection(credentials)
            break
          default:
            return { success: false, error: '不支持的 CMS 类型' }
        }
        // 追踪 CMS 测试连接
        trackCmsManagement('test', type, result.success).catch(() => {})
        return result
      } catch (error) {
        trackCmsManagement('test', type, false).catch(() => {})
        return { success: false, error: (error as Error).message }
      }
    }

    case 'SYNC_TO_CMS': {
      const { accountId, article } = message.payload

      try {
        // 获取账户信息
        const storage = await chrome.storage.local.get(['cmsAccounts', `cms_pwd_${accountId}`])
        const accounts = storage.cmsAccounts || []
        const account = accounts.find((a: any) => a.id === accountId)

        if (!account) {
          return { success: false, error: '账户不存在' }
        }

        const password = storage[`cms_pwd_${accountId}`]
        if (!password) {
          return { success: false, error: '密码未找到，请重新添加账户' }
        }

        const credentials = {
          url: account.url,
          username: account.username,
          password,
        }

        let result
        switch (account.type) {
          case 'wordpress':
            result = await wordpressAdapter.publish(credentials, article, { draftOnly: true })
            break
          case 'typecho':
            result = await metaweblogAdapter.publishToTypecho(credentials, article, { draftOnly: true })
            break
          case 'metaweblog':
            result = await metaweblogAdapter.publish(credentials, article, { draftOnly: true })
            break
          default:
            return { success: false, error: '不支持的 CMS 类型' }
        }

        // 追踪 CMS 同步结果（含错误类型）
        trackCmsSync('popup', account.type, result.success).catch(() => {})
        if (result.success) {
          // 追踪 CMS 用户里程碑
          trackMilestone('cms_user').catch(() => {})
        } else if (result.error) {
          // 额外追踪错误类型用于问题分析
          trackFeatureUse('cms_sync_error', {
            cms_type: account.type,
            error_type: inferErrorType(result.error),
          }).catch(() => {})
        }

        return {
          platform: account.name,
          success: result.success,
          postUrl: result.postUrl,
          postId: result.postId,
          error: result.error,
          draftOnly: true,
          timestamp: Date.now(),
        }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }

    case 'MCP_ENABLE': {
      await chrome.storage.local.set({ mcpEnabled: true })
      startMcpClient()
      logger.info(' MCP enabled')
      trackMcpUsage('enable').catch(() => {})
      // 追踪 MCP 用户里程碑
      trackMilestone('mcp_user').catch(() => {})
      return { success: true }
    }

    case 'MCP_DISABLE': {
      await chrome.storage.local.set({ mcpEnabled: false })
      stopMcpClient()
      logger.info(' MCP disabled')
      trackMcpUsage('disable').catch(() => {})
      return { success: true }
    }

    case 'MCP_STATUS': {
      const storage = await chrome.storage.local.get('mcpEnabled')
      const mcpStatus = getMcpStatus()
      return {
        enabled: storage.mcpEnabled ?? false,
        connected: mcpStatus.connected,
      }
    }

    case 'TRACK_ARTICLE_EXTRACT': {
      const { source, success, hasTitle, hasContent, hasCover, contentLength } = message.payload
      trackArticleExtract(source, success, { hasTitle, hasContent, hasCover, contentLength }).catch(() => {})
      return { success: true }
    }

    case 'GET_SYNC_STATE': {
      const storage = await chrome.storage.local.get(SYNC_STATE_KEY)
      return { syncState: storage[SYNC_STATE_KEY] || null }
    }

    case 'CLEAR_SYNC_STATE': {
      await clearSyncState()
      return { success: true }
    }

    case 'CANCEL_SYNC': {
      const cancelled = cancelSync()
      logger.info('Sync cancelled:', cancelled)
      return { success: cancelled }
    }

    case 'START_SYNC_FROM_EDITOR': {
      const { article, platforms } = message
      const tabId = sender?.tab?.id
      const allPlatformMetas = getAllPlatformMetas()

      if (!tabId) {
        return { error: 'No tab ID found' }
      }

      // content script 已经转换好 html 和 markdown 字段

      // 获取 CMS 账户信息以区分 DSL 和 CMS
      const cmsStorage = await chrome.storage.local.get('cmsAccounts')
      const cmsAccounts = cmsStorage.cmsAccounts || []
      const cmsAccountIds = new Set(cmsAccounts.map((a: any) => a.id))

      // 分离 DSL 平台和 CMS 账户
      const dslPlatformIds = platforms.filter((id: string) => !cmsAccountIds.has(id))
      const cmsPlatformIds = platforms.filter((id: string) => cmsAccountIds.has(id))

      // 初始化同步状态
      const syncState: ActiveSyncState = {
        status: 'syncing',
        article: {
          title: article.title,
          cover: article.cover,
          content: article.content,
          html: article.html,
        },
        selectedPlatforms: platforms,
        results: [],
        startTime: Date.now(),
      }
      await saveSyncState(syncState)

      const allResults: any[] = []

      // 同步到 DSL 平台
      if (dslPlatformIds.length > 0) {
        await syncToMultiplePlatforms(dslPlatformIds, article, {
          onResult: (result) => {
            // 更新持久化状态
            const resultWithName = {
              ...result,
              platformName: allPlatformMetas.find(p => p.id === result.platform)?.name || result.platform,
            }
            syncState.results.push(resultWithName)
            allResults.push(resultWithName)
            saveSyncState(syncState).catch(() => {})

            // 发送进度到 content script (编辑器)
            chrome.tabs.sendMessage(tabId, {
              type: 'SYNC_PROGRESS',
              result: resultWithName,
            }).catch(() => {})
          },
          onImageProgress: (platform, current, total) => {
            chrome.tabs.sendMessage(tabId, {
              type: 'IMAGE_PROGRESS',
              platform, current, total,
            }).catch(() => {})
          },
        }, 'editor')
        // dslResults 已经通过 onResult 回调添加到 allResults
      }

      // 同步到 CMS 账户
      for (const accountId of cmsPlatformIds) {
        const account = cmsAccounts.find((a: any) => a.id === accountId)
        if (!account) continue

        try {
          const passwordStorage = await chrome.storage.local.get(`cms_pwd_${accountId}`)
          const password = passwordStorage[`cms_pwd_${accountId}`]
          if (!password) {
            const cmsResult = {
              platform: accountId,
              platformName: account.name,
              success: false,
              error: '密码未找到',
            }
            allResults.push(cmsResult)
            syncState.results.push(cmsResult)
            saveSyncState(syncState).catch(() => {})
            chrome.tabs.sendMessage(tabId, { type: 'SYNC_PROGRESS', result: cmsResult }).catch(() => {})
            continue
          }

          const credentials = { url: account.url, username: account.username, password }
          let result
          switch (account.type) {
            case 'wordpress':
              result = await wordpressAdapter.publish(credentials, article, { draftOnly: true })
              break
            case 'typecho':
              result = await metaweblogAdapter.publishToTypecho(credentials, article, { draftOnly: true })
              break
            case 'metaweblog':
              result = await metaweblogAdapter.publish(credentials, article, { draftOnly: true })
              break
            default:
              result = { success: false, error: '不支持的 CMS 类型' }
          }

          const cmsResult = {
            platform: accountId,
            platformName: account.name,
            success: result.success,
            postUrl: result.postUrl,
            draftOnly: true,
            error: result.error,
          }
          allResults.push(cmsResult)
          syncState.results.push(cmsResult)
          saveSyncState(syncState).catch(() => {})
          chrome.tabs.sendMessage(tabId, { type: 'SYNC_PROGRESS', result: cmsResult }).catch(() => {})
        } catch (error) {
          const cmsResult = {
            platform: accountId,
            platformName: account.name,
            success: false,
            error: (error as Error).message,
          }
          allResults.push(cmsResult)
          syncState.results.push(cmsResult)
          saveSyncState(syncState).catch(() => {})
          chrome.tabs.sendMessage(tabId, { type: 'SYNC_PROGRESS', result: cmsResult }).catch(() => {})
        }
      }

      // 更新为完成状态
      syncState.status = 'completed'
      await saveSyncState(syncState)

      // 通知编辑器同步完成
      chrome.tabs.sendMessage(tabId, {
        type: 'SYNC_COMPLETE',
      }).catch(() => {})

      // 保存到历史
      await saveToHistory(article, allResults, allPlatformMetas)

      return { results: allResults }
    }

    default:
      return { error: 'Unknown message type' }
  }
}

/**
 * 创建右键菜单
 */
function createContextMenu() {
  chrome.contextMenus.create({
    id: 'wechatsync-open-editor',
    title: '同步助手 - 提取并编辑文章',
    contexts: ['page', 'selection'],
  })
}

// CMS 图标
function getCmsIcon(type: string): string {
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

/**
 * 处理右键菜单点击
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'wechatsync-open-editor' && tab?.id) {
    try {
      // 获取 DSL 平台
      const dslPlatforms = await checkAllPlatformsAuth(false)

      // 获取 CMS 账户
      const cmsStorage = await chrome.storage.local.get('cmsAccounts')
      const cmsAccounts = cmsStorage.cmsAccounts || []
      const cmsPlatforms = cmsAccounts
        .filter((a: any) => a.isConnected)
        .map((a: any) => ({
          id: a.id,
          name: a.name,
          icon: getCmsIcon(a.type),
          homepage: a.url,
          isAuthenticated: true,
          username: a.username,
          sourceType: 'cms' as const,
          cmsType: a.type,
        }))

      // 合并所有平台
      const allPlatforms = [...dslPlatforms, ...cmsPlatforms]

      // 发送消息到 content script 打开编辑器
      chrome.tabs.sendMessage(tab.id, {
        type: 'OPEN_EDITOR',
        platforms: allPlatforms,
        selectedPlatforms: [], // 右键打开时默认选中所有已登录平台
      })
    } catch (error) {
      logger.error(' Failed to open editor from context menu:', error)
    }
  }
})

/**
 * 扩展安装/更新
 */
chrome.runtime.onInstalled.addListener(async details => {
  logger.info(' Installed:', details.reason, details.previousVersion)

  // 创建右键菜单
  createContextMenu()

  // 预加载适配器
  await initAdapters()

  // 追踪安装/更新
  trackInstall(details.reason, details.previousVersion).catch(() => {})

  // 记录安装时间（用于首次同步追踪）
  if (details.reason === 'install') {
    recordInstallTimestamp().catch(() => {})
  }

  // 升级时打开 changelog 页面
  if (details.reason === 'update') {
    const previousVersion = details.previousVersion || '0.0.0'
    const currentVersion = chrome.runtime.getManifest().version

    // 从 1.x 升级到 2.x，显示更新日志
    if (previousVersion.startsWith('1.') && currentVersion.startsWith('2.')) {
      chrome.tabs.create({
        url: 'https://www.wechatsync.com/changelog?from=' + previousVersion + '&to=' + currentVersion,
        active: true,
      })
    }
  }

  // 首次安装时打开欢迎页
  if (details.reason === 'install') {
    chrome.tabs.create({
      url: 'https://www.wechatsync.com/?utm_source=extension&utm_medium=install',
      active: true,
    })
  }
})

/**
 * 启动时初始化 MCP（如果已启用）
 */
async function initMcpIfEnabled() {
  const storage = await chrome.storage.local.get('mcpEnabled')
  if (storage.mcpEnabled) {
    logger.info(' Starting MCP client...')
    startMcpClient()
  }
}

// 启动 MCP 客户端（如果已启用）
initMcpIfEnabled()

/**
 * 预检查平台认证状态（后台静默执行）
 * 在扩展启动/安装时预热缓存，提升 popup 打开速度
 */
async function preCheckPlatformsAuth() {
  logger.info(' Pre-checking platform auth...')
  try {
    await checkAllPlatformsAuth(false) // 使用缓存，不强制刷新
    logger.info(' Pre-check completed')
  } catch (error) {
    logger.error(' Pre-check failed:', error)
  }
}

// 浏览器启动时预检查
chrome.runtime.onStartup.addListener(() => {
  logger.info(' Browser started, pre-checking auth...')
  preCheckPlatformsAuth()
})

// Service Worker 激活时也预检查（首次加载或唤醒）
preCheckPlatformsAuth()

// 设置每日增长指标追踪
chrome.alarms.create('daily_growth_metrics', { periodInMinutes: 24 * 60 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'daily_growth_metrics') {
    trackGrowthMetrics().catch(() => {})
  }
})

// 首次启动时也追踪一次增长指标
trackGrowthMetrics().catch(() => {})

logger.info('Service Worker started')

// 最大历史记录数
const MAX_HISTORY_ITEMS = 25

interface SyncResult {
  platform: string
  platformName?: string
  success: boolean
  postUrl?: string
  draftOnly?: boolean
  error?: string
}

interface SyncHistoryItem {
  id: string
  title: string
  cover?: string
  timestamp: number
  results: SyncResult[]
}

/**
 * 保存同步历史记录
 */
async function saveToHistory(
  article: { title: string; cover?: string },
  results: SyncResult[],
  allPlatformMetas: Array<{ id: string; name: string }>
): Promise<void> {
  try {
    // 为结果添加平台名称
    const resultsWithNames = results.map(r => ({
      ...r,
      platformName: allPlatformMetas.find(p => p.id === r.platform)?.name || r.platform,
    }))

    // 读取现有历史
    const storage = await chrome.storage.local.get('syncHistory')
    const existingHistory: SyncHistoryItem[] = storage.syncHistory || []

    // 创建新历史条目
    const historyItem: SyncHistoryItem = {
      id: Date.now().toString(),
      title: article.title || '未知文章',
      cover: article.cover,
      timestamp: Date.now(),
      results: resultsWithNames,
    }

    // 添加到历史并限制数量
    const newHistory = [historyItem, ...existingHistory].slice(0, MAX_HISTORY_ITEMS)

    // 保存到 storage
    await chrome.storage.local.set({ syncHistory: newHistory })
    logger.info(' History saved:', historyItem.title)
  } catch (error) {
    logger.error(' Failed to save history:', error)
  }
}
