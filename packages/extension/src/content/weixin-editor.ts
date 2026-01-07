/**
 * 微信公众号后台编辑器页面 Content Script
 * 在编辑页面提供同步面板（可拖动、可收起）
 */
import { createLogger } from '../lib/logger'

const logger = createLogger('WeixinEditor')

;(() => {
interface Platform {
  id: string
  name: string
  icon: string
  isAuthenticated: boolean
}

interface SyncResult {
  platform: string
  success: boolean
  postUrl?: string
  error?: string
}

type ViewState = 'loading' | 'platforms' | 'syncing' | 'results' | 'empty'

interface State {
  view: ViewState
  platforms: Platform[]
  selectedPlatforms: string[]
  results: SyncResult[]
  collapsed: boolean
}

const state: State = {
  view: 'loading',
  platforms: [],
  selectedPlatforms: [],
  results: [],
  collapsed: true, // 默认收起
}

// 检查是否是编辑页面
function isEditorPage(): boolean {
  const url = window.location.href
  return url.includes('mp.weixin.qq.com/cgi-bin/appmsg') &&
         (url.includes('action=edit') || url.includes('appmsg_edit'))
}

// 注入同步面板
async function injectSyncPanel() {
  if (document.querySelector('#wechatsync-editor-panel')) return

  const panel = document.createElement('div')
  panel.id = 'wechatsync-editor-panel'
  panel.innerHTML = `
    <style>
      #wechatsync-editor-panel {
        position: fixed;
        right: 20px;
        bottom: 80px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
      }

      #wechatsync-editor-panel * {
        box-sizing: border-box;
      }

      /* 收起时只显示圆形按钮 */
      .ws-fab {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: linear-gradient(135deg, #07c160 0%, #06ad56 100%);
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(7, 193, 96, 0.4);
        transition: all 0.2s;
      }

      .ws-fab:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 16px rgba(7, 193, 96, 0.5);
      }

      .ws-fab svg {
        width: 24px;
        height: 24px;
        fill: white;
      }

      .ws-fab.hidden {
        display: none;
      }

      /* 展开的面板 */
      .ws-panel {
        width: 260px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
        overflow: hidden;
        display: none;
      }

      .ws-panel.visible {
        display: block;
      }

      .ws-header {
        background: linear-gradient(135deg, #07c160 0%, #06ad56 100%);
        color: white;
        padding: 10px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: move;
        user-select: none;
      }

      .ws-header-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
      }

      .ws-header-title svg {
        width: 16px;
        height: 16px;
      }

      .ws-close {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        padding: 4px;
        display: flex;
        opacity: 0.8;
      }

      .ws-close:hover {
        opacity: 1;
      }

      .ws-content {
        padding: 12px;
        max-height: 300px;
        overflow-y: auto;
      }

      .ws-section-title {
        font-size: 11px;
        color: #999;
        margin-bottom: 8px;
      }

      .ws-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 180px;
        overflow-y: auto;
        margin-bottom: 10px;
      }

      .ws-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        border-radius: 6px;
        cursor: pointer;
        background: #f5f5f5;
        border: 2px solid transparent;
        transition: all 0.15s;
      }

      .ws-item:hover {
        background: #e8f5e9;
      }

      .ws-item.selected {
        border-color: #07c160;
        background: #e8f5e9;
      }

      .ws-item img {
        width: 18px;
        height: 18px;
        border-radius: 4px;
        flex-shrink: 0;
      }

      .ws-item-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ws-item-status {
        font-size: 11px;
        flex-shrink: 0;
      }

      .ws-item-status.success { color: #52c41a; }
      .ws-item-status.error { color: #ff4d4f; }

      .ws-btn {
        width: 100%;
        padding: 10px;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
      }

      .ws-btn-primary {
        background: #07c160;
        color: white;
      }

      .ws-btn-primary:hover {
        background: #06ad56;
      }

      .ws-btn-primary:disabled {
        background: #ccc;
        cursor: not-allowed;
      }

      .ws-btn-secondary {
        background: white;
        color: #666;
        border: 1px solid #ddd;
        margin-top: 8px;
      }

      .ws-btn-secondary:hover {
        border-color: #07c160;
        color: #07c160;
      }

      .ws-loading, .ws-empty {
        text-align: center;
        padding: 20px 12px;
        color: #999;
        font-size: 12px;
      }

      .ws-empty a {
        color: #07c160;
        text-decoration: none;
      }

      .ws-result {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        border-radius: 6px;
        margin-bottom: 6px;
        font-size: 12px;
      }

      .ws-result.success {
        background: #f6ffed;
        border: 1px solid #b7eb8f;
      }

      .ws-result.error {
        background: #fff2f0;
        border: 1px solid #ffccc7;
      }

      .ws-result img {
        width: 16px;
        height: 16px;
        border-radius: 3px;
      }

      .ws-result-name { flex: 1; }

      .ws-result a {
        color: #1890ff;
        text-decoration: none;
        font-size: 11px;
      }

      .ws-footer {
        padding: 8px 12px;
        border-top: 1px solid #f0f0f0;
        display: flex;
        justify-content: space-between;
        font-size: 11px;
      }

      .ws-footer a {
        color: #999;
        text-decoration: none;
      }

      .ws-footer a:hover {
        color: #07c160;
      }

      @keyframes ws-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .ws-spinning {
        animation: ws-spin 1s linear infinite;
      }
    </style>

    <!-- 收起时的悬浮按钮 -->
    <button class="ws-fab" id="ws-fab" title="同步助手">
      <svg viewBox="0 0 24 24">
        <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
      </svg>
    </button>

    <!-- 展开的面板 -->
    <div class="ws-panel" id="ws-panel">
      <div class="ws-header" id="ws-header">
        <span class="ws-header-title">
          <svg viewBox="0 0 24 24" fill="white">
            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
          </svg>
          同步助手
        </span>
        <button class="ws-close" id="ws-close" title="收起">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
      <div class="ws-content" id="ws-content"></div>
      <div class="ws-footer">
        <a href="javascript:void(0)" id="ws-history">同步历史</a>
        <a href="javascript:void(0)" id="ws-popup">完整面板</a>
      </div>
    </div>
  `

  document.body.appendChild(panel)
  bindEvents()
  loadPlatforms()
}

function bindEvents() {
  const fab = document.getElementById('ws-fab')!
  const panel = document.getElementById('ws-panel')!
  const header = document.getElementById('ws-header')!
  const closeBtn = document.getElementById('ws-close')!
  const historyLink = document.getElementById('ws-history')!
  const popupLink = document.getElementById('ws-popup')!
  const container = document.getElementById('wechatsync-editor-panel')!

  // 展开面板
  fab.addEventListener('click', () => {
    state.collapsed = false
    fab.classList.add('hidden')
    panel.classList.add('visible')
  })

  // 收起面板
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    state.collapsed = true
    fab.classList.remove('hidden')
    panel.classList.remove('visible')
  })

  // 拖动面板
  let isDragging = false
  let startX = 0
  let startY = 0
  let startRight = 20
  let startBottom = 80

  header.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('.ws-close')) return
    isDragging = true
    startX = e.clientX
    startY = e.clientY
    const rect = container.getBoundingClientRect()
    startRight = window.innerWidth - rect.right
    startBottom = window.innerHeight - rect.bottom
    e.preventDefault()
  })

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return
    const dx = startX - e.clientX
    const dy = startY - e.clientY
    const newRight = Math.max(0, Math.min(window.innerWidth - 280, startRight + dx))
    const newBottom = Math.max(0, Math.min(window.innerHeight - 100, startBottom + dy))
    container.style.right = newRight + 'px'
    container.style.bottom = newBottom + 'px'
  })

  document.addEventListener('mouseup', () => {
    isDragging = false
  })

  // 历史
  historyLink.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    chrome.runtime.sendMessage({ type: 'OPEN_SYNC_PAGE', path: '/history' })
  })

  // 完整面板
  popupLink.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const article = await extractArticle()
    if (article) {
      await chrome.storage.local.set({ pendingArticle: article })
    }
    chrome.runtime.sendMessage({ type: 'OPEN_SYNC_PAGE' })
  })
}

// CMS 图标
function getCmsIcon(type: string): string {
  switch (type) {
    case 'wordpress':
      return 'https://s.w.org/style/images/about/WordPress-logotype-simplified.png'
    case 'typecho':
      return chrome.runtime.getURL('assets/typecho.ico')
    case 'metaweblog':
      return 'https://www.cnblogs.com/favicon.ico'
    default:
      return chrome.runtime.getURL('assets/icon-48.png')
  }
}

async function loadPlatforms() {
  renderView('loading')

  try {
    // 获取 DSL 平台
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_ALL_AUTH' })
    const dslPlatforms = (response.platforms || []).filter((p: Platform) => p.isAuthenticated)

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
    state.platforms = [...dslPlatforms, ...cmsPlatforms]

    const storage = await chrome.storage.local.get('lastSelectedPlatforms')
    state.selectedPlatforms = storage.lastSelectedPlatforms || []

    if (state.platforms.length === 0) {
      renderView('empty')
    } else {
      renderView('platforms')
    }
  } catch (error) {
    logger.error('Failed to load platforms:', error)
    renderView('empty')
  }
}

function renderView(view: ViewState) {
  state.view = view
  const content = document.getElementById('ws-content')!

  switch (view) {
    case 'loading':
      content.innerHTML = `<div class="ws-loading">加载中...</div>`
      break

    case 'empty':
      content.innerHTML = `
        <div class="ws-empty">
          暂无已登录平台<br>
          <a href="javascript:void(0)" id="ws-login">去登录 →</a>
        </div>
      `
      document.getElementById('ws-login')?.addEventListener('click', (e) => {
        e.preventDefault()
        chrome.runtime.sendMessage({ type: 'OPEN_SYNC_PAGE' })
      })
      break

    case 'platforms':
      renderPlatformList()
      break

    case 'syncing':
      content.innerHTML = `
        <div class="ws-loading">
          <svg class="ws-spinning" width="24" height="24" viewBox="0 0 24 24" fill="#07c160">
            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
          </svg>
          <div style="margin-top: 8px">同步中...</div>
          <button class="ws-btn ws-btn-secondary" id="ws-cancel" style="margin-top: 12px; font-size: 12px; padding: 6px 16px;">取消</button>
        </div>
      `
      document.getElementById('ws-cancel')?.addEventListener('click', () => {
        state.results = []
        renderView('platforms')
      })
      break

    case 'results':
      renderResults()
      break
  }
}

function renderPlatformList() {
  const content = document.getElementById('ws-content')!
  const count = state.selectedPlatforms.length

  content.innerHTML = `
    <div class="ws-section-title">选择同步平台</div>
    <div class="ws-list" id="ws-list">
      ${state.platforms.map(p => {
        const selected = state.selectedPlatforms.includes(p.id)
        return `
          <div class="ws-item ${selected ? 'selected' : ''}" data-id="${p.id}">
            <img src="${p.icon}" alt="${p.name}" onerror="this.style.display='none'">
            <span class="ws-item-name">${p.name}</span>
          </div>
        `
      }).join('')}
    </div>
    <button class="ws-btn ws-btn-primary" id="ws-sync" ${count === 0 ? 'disabled' : ''}>
      ${count > 0 ? `同步到 ${count} 个平台` : '请选择平台'}
    </button>
  `

  // 绑定平台选择
  document.querySelectorAll('.ws-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-id')!
      el.classList.toggle('selected')

      if (el.classList.contains('selected')) {
        if (!state.selectedPlatforms.includes(id)) {
          state.selectedPlatforms.push(id)
        }
      } else {
        state.selectedPlatforms = state.selectedPlatforms.filter(p => p !== id)
      }

      // 更新按钮
      const btn = document.getElementById('ws-sync') as HTMLButtonElement
      const count = state.selectedPlatforms.length
      btn.disabled = count === 0
      btn.textContent = count > 0 ? `同步到 ${count} 个平台` : '请选择平台'
    })
  })

  // 绑定同步按钮
  document.getElementById('ws-sync')?.addEventListener('click', startSync)
}

function renderResults() {
  const content = document.getElementById('ws-content')!
  const successCount = state.results.filter(r => r.success).length
  const totalCount = state.results.length

  content.innerHTML = `
    <div class="ws-section-title">同步结果 (${successCount}/${totalCount})</div>
    <div class="ws-list">
      ${state.results.map(r => {
        const platform = state.platforms.find(p => p.id === r.platform)
        return `
          <div class="ws-result ${r.success ? 'success' : 'error'}">
            <img src="${platform?.icon || ''}" alt="${platform?.name || r.platform}" onerror="this.style.display='none'">
            <span class="ws-result-name">${platform?.name || r.platform}</span>
            ${r.success && r.postUrl
              ? `<a href="${r.postUrl}" target="_blank">查看 →</a>`
              : `<span class="ws-item-status error">${r.error || '失败'}</span>`
            }
          </div>
        `
      }).join('')}
    </div>
    <button class="ws-btn ws-btn-secondary" id="ws-back">返回继续同步</button>
  `

  document.getElementById('ws-back')?.addEventListener('click', () => {
    state.results = []
    renderView('platforms')
  })
}

async function startSync() {
  const article = await extractArticle()
  if (!article) {
    alert('未能提取文章内容\n\n请确保：\n1. 文章已保存\n2. 标题和内容不为空')
    // 追踪文章提取失败
    chrome.runtime.sendMessage({
      type: 'TRACK_ARTICLE_EXTRACT',
      payload: { source: 'weixin-editor', success: false },
    }).catch(() => {})
    return
  }

  // 追踪文章提取成功
  chrome.runtime.sendMessage({
    type: 'TRACK_ARTICLE_EXTRACT',
    payload: {
      source: 'weixin-editor',
      success: true,
      hasTitle: !!article.title,
      hasContent: !!article.content,
      hasCover: !!article.cover,
      contentLength: article.content?.length || 0,
    },
  }).catch(() => {})

  if (state.selectedPlatforms.length === 0) {
    alert('请选择要同步的平台')
    return
  }

  await chrome.storage.local.set({ lastSelectedPlatforms: state.selectedPlatforms })

  renderView('syncing')

  try {
    // 分离 DSL 平台和 CMS 账户
    const dslPlatformIds = state.selectedPlatforms.filter(id => {
      const p = state.platforms.find(p => p.id === id)
      return !p || (p as any).sourceType !== 'cms'
    })
    const cmsPlatformIds = state.selectedPlatforms.filter(id => {
      const p = state.platforms.find(p => p.id === id)
      return p && (p as any).sourceType === 'cms'
    })

    const allResults: any[] = []

    // 同步到 DSL 平台
    if (dslPlatformIds.length > 0) {
      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_ARTICLE',
        payload: { article, platforms: dslPlatformIds, source: 'weixin-editor' },
      })
      if (response.results) {
        allResults.push(...response.results)
      }
    }

    // 同步到 CMS 账户
    for (const accountId of cmsPlatformIds) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'SYNC_TO_CMS',
          payload: { accountId, article },
        })
        const platform = state.platforms.find(p => p.id === accountId)
        allResults.push({
          platform: accountId,
          platformName: platform?.name,
          success: response.success,
          postUrl: response.postUrl,
          draftOnly: response.draftOnly,
          error: response.error,
        })
      } catch (error) {
        allResults.push({
          platform: accountId,
          success: false,
          error: (error as Error).message,
        })
      }
    }

    state.results = allResults
    renderView('results')
  } catch (error) {
    alert('同步失败：' + (error as Error).message)
    renderView('platforms')
  }
}

async function extractArticle(): Promise<any | null> {
  try {
    logger.debug('Extracting article...')

    // 获取标题 - 尝试多种选择器
    const titleSelectors = [
      '#js_title_place',      // 微信编辑器标题
      '#title',
      'input[name="title"]',
      '.weui-desktop-form__input',
      '.title_input input',
      '.js_title',
      '[data-id="title"]',
      '.appmsg_title input',
      '.appmsg-edit-title input',
    ]
    let title = ''
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel) as HTMLInputElement
      // 支持 input 和 contenteditable 元素
      const value = el?.value?.trim() || el?.textContent?.trim()
      if (value) {
        title = value
        logger.debug('Title found via:', sel, '=', title.substring(0, 30))
        break
      }
    }

    // 获取内容 - 尝试多种方式
    let content = ''

    // 方式1: 从 iframe 编辑器 (微信使用 UEditor)
    const frameSelectors = [
      '#ueditor_0',              // 微信默认编辑器 iframe
      'iframe[id^="ueditor"]',   // UEditor 变体
      '.edui-editor iframe',
      'iframe.edui-body-container',
    ]
    for (const sel of frameSelectors) {
      try {
        const frame = document.querySelector(sel) as HTMLIFrameElement
        if (frame?.contentDocument?.body) {
          const html = frame.contentDocument.body.innerHTML
          if (html && html.trim() && html.trim() !== '<p><br></p>' && html.length > 10) {
            content = html
            logger.debug('Content found via iframe:', sel)
            break
          }
        }
      } catch (e) {
        // 跨域 iframe 访问可能失败
        logger.debug('Cannot access iframe:', sel)
      }
    }

    // 方式2: 从页面容器
    if (!content) {
      const containerSelectors = ['.edui-body-container', '.rich_media_content', '#js_content', '.appmsg-edit-content']
      for (const sel of containerSelectors) {
        const el = document.querySelector(sel)
        if (el?.innerHTML && el.innerHTML.trim().length > 10) {
          content = el.innerHTML
          logger.debug('Content found via container:', sel)
          break
        }
      }
    }

    // 方式3: 通过 API 获取（已保存的文章）
    const appmsgid = new URLSearchParams(window.location.search).get('appmsgid')
    if (appmsgid && (!content || !title)) {
      logger.debug('Trying API fetch for appmsgid:', appmsgid)
      const article = await fetchArticleByApi(appmsgid)
      if (article) {
        logger.debug('Article fetched via API')
        return article
      }
    }

    // 检查必要字段
    if (!title) {
      logger.warn('Title not found. Available inputs:', document.querySelectorAll('input').length)
      return null
    }

    if (!content) {
      logger.warn('Content not found. Available iframes:', document.querySelectorAll('iframe').length)
      return null
    }

    // 获取封面
    const coverSelectors = ['.appmsg_thumb img', '.js_cover img', '.cover-img img', '.appmsg_thumb_wrap img']
    let cover = ''
    for (const sel of coverSelectors) {
      const img = document.querySelector(sel) as HTMLImageElement
      if (img?.src && !img.src.includes('data:')) {
        cover = img.src
        break
      }
    }

    // 获取摘要
    const digestSelectors = ['[name="digest"]', '#digest', 'textarea.digest', '.appmsg_desc textarea']
    let summary = ''
    for (const sel of digestSelectors) {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement
      if (el?.value) {
        summary = el.value
        break
      }
    }

    logger.debug('Extracted:', { title, contentLen: content.length, hasCover: !!cover })
    return { title, html: content, content, summary, cover, source: { url: window.location.href, platform: 'weixin-editor' } }
  } catch (error) {
    logger.error('Extract failed:', error)
    return null
  }
}

async function fetchArticleByApi(appmsgid: string): Promise<any | null> {
  try {
    const tokenMatch = window.location.search.match(/token=(\d+)/)
    if (!tokenMatch) return null

    const token = tokenMatch[1]
    const tempRes = await fetch(
      `https://mp.weixin.qq.com/cgi-bin/appmsg?action=get_temp_url&appmsgid=${appmsgid}&itemidx=1&token=${token}&lang=zh_CN&f=json&ajax=1`,
      { credentials: 'include' }
    )
    const tempData = await tempRes.json()
    if (!tempData.temp_url) return null

    const htmlRes = await fetch(tempData.temp_url)
    const html = await htmlRes.text()

    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')

    const title = doc.querySelector('#activity-name')?.textContent?.trim()
    const contentEl = doc.querySelector('#js_content')
    const cover = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
    const summary = doc.querySelector('meta[property="og:description"]')?.getAttribute('content')

    if (!title || !contentEl) return null

    // 处理懒加载图片
    contentEl.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('data-src') || img.getAttribute('data-original') || img.src
      if (src && !src.startsWith('data:')) img.src = src
    })

    return { title, html: contentEl.innerHTML, content: contentEl.innerHTML, summary, cover, source: { url: tempData.temp_url, platform: 'weixin' } }
  } catch (error) {
    logger.error('API fetch failed:', error)
    return null
  }
}

// 初始化
function init() {
  if (!isEditorPage()) return

  const inject = () => setTimeout(injectSyncPanel, 1500)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject)
  } else {
    inject()
  }
}

init()
})()
