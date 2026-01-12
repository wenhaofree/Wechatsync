/**
 * MCP WebSocket Client - 连接 MCP Server
 */
import {
  checkAllPlatformsAuth,
  checkPlatformAuth,
  getAdapter,
} from '../adapters'
import { markdownToHtml } from '@wechatsync/core'
import { createLogger } from '../lib/logger'

const logger = createLogger('MCPClient')

// 消息类型
interface RequestMessage {
  id: string
  method: string
  token?: string  // 安全验证 token
  params?: Record<string, unknown>
}

interface ResponseMessage {
  id: string
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

class McpClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private serverUrl = 'ws://localhost:9527'

  // 安全验证 token
  private token: string | null = null

  // 指数退避重连配置
  private reconnectAttempts = 0
  private readonly minReconnectInterval = 1000 // 1 秒
  private readonly maxReconnectInterval = 30000 // 30 秒
  private readonly maxReconnectAttempts = 100 // 最大尝试次数（约 30 分钟后停止）

  /**
   * 设置安全验证 token
   */
  setToken(token: string): void {
    this.token = token
    logger.debug('Token set')
  }

  /**
   * 清除 token
   */
  clearToken(): void {
    this.token = null
  }

  /**
   * 连接到 MCP Server
   */
  connect(): void {
    // 清理旧连接
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        logger.debug('Already connected')
        return
      }
      // 清理非 OPEN 状态的连接
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.onmessage = null
      this.ws.onopen = null
      if (this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close()
      }
      this.ws = null
    }

    logger.debug(`Connecting to ${this.serverUrl} (attempt ${this.reconnectAttempts + 1})`)

    try {
      this.ws = new WebSocket(this.serverUrl)

      this.ws.onopen = () => {
        logger.debug('Connected to MCP Server')
        this.reconnectAttempts = 0 // 重置重连计数
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer)
          this.reconnectTimer = null
        }
      }

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data)
      }

      this.ws.onclose = (event) => {
        logger.debug(`Disconnected (code: ${event.code}), scheduling reconnect...`)
        this.ws = null
        this.scheduleReconnect()
      }

      this.ws.onerror = () => {
        // error 事件后通常会触发 close，不需要在这里重连
        logger.debug('Connection error')
      }
    } catch (error) {
      logger.error('Connection failed:', error)
      this.ws = null
      this.scheduleReconnect()
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.reconnectAttempts = this.maxReconnectAttempts // 防止自动重连
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null // 防止触发重连
      this.ws.close()
      this.ws = null
    }
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * 计划重连（指数退避）
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.debug('Max reconnect attempts reached, stopping')
      return
    }

    // 指数退避：1s, 2s, 4s, 8s, 16s, 30s, 30s, ...
    const interval = Math.min(
      this.minReconnectInterval * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectInterval
    )

    logger.debug(`Reconnecting in ${interval / 1000}s...`)

    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, interval)
  }

  /**
   * 重置重连计数（供外部调用）
   */
  resetReconnect(): void {
    this.reconnectAttempts = 0
    if (!this.isConnected()) {
      this.connect()
    }
  }

  /**
   * 处理来自 MCP Server 的请求
   */
  private async handleMessage(data: string): Promise<void> {
    try {
      const message: RequestMessage = JSON.parse(data)
      logger.debug('Received:', message.method)

      let result: unknown
      let error: { code: number; message: string } | undefined

      // Token 验证
      if (!this.token) {
        error = {
          code: 401,
          message: 'MCP token not configured',
        }
      } else if (message.token !== this.token) {
        logger.warn('Invalid token received')
        error = {
          code: 403,
          message: 'Invalid or missing token',
        }
      } else {
        try {
          result = await this.handleMethod(message.method, message.params)
        } catch (e) {
          error = {
            code: -1,
            message: (e as Error).message,
          }
        }
      }

      const response: ResponseMessage = {
        id: message.id,
        result,
        error,
      }

      this.ws?.send(JSON.stringify(response))
    } catch (error) {
      logger.error('Failed to handle message:', error)
    }
  }

  /**
   * 处理具体方法调用
   */
  private async handleMethod(
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      case 'listPlatforms': {
        const forceRefresh = (params?.forceRefresh as boolean) ?? false
        return await checkAllPlatformsAuth(forceRefresh)
      }

      case 'checkAuth': {
        const platform = params?.platform as string
        if (!platform) throw new Error('Missing platform parameter')
        return await checkPlatformAuth(platform)
      }

      case 'syncArticle': {
        const platforms = params?.platforms as string[]
        const articleData = params?.article as {
          title: string
          content?: string
          markdown?: string
          cover?: string
        }

        if (!platforms?.length) throw new Error('Missing platforms parameter')
        if (!articleData?.title) throw new Error('Missing article title')
        if (!articleData?.markdown && !articleData?.content) {
          throw new Error('Missing article content (markdown or content required)')
        }

        // 优先使用 markdown，转换为 HTML
        let htmlContent = articleData.content || ''
        const markdown = articleData.markdown || ''

        if (markdown) {
          try {
            htmlContent = markdownToHtml(markdown)
          } catch (e) {
            logger.error('Markdown conversion failed:', e)
            // 如果转换失败，使用简单的换行处理
            htmlContent = markdown.replace(/\n/g, '<br>')
          }
        }

        // 通过消息发送，确保历史记录被保存
        const response = await chrome.runtime.sendMessage({
          type: 'SYNC_ARTICLE',
          payload: {
            article: {
              title: articleData.title,
              content: htmlContent,
              html: htmlContent,
              markdown: markdown,
              cover: articleData.cover,
            },
            platforms,
            source: 'mcp',
          },
        })

        if (response.error) {
          throw new Error(response.error)
        }

        return response.results
      }

      case 'extractArticle': {
        // 从当前活动 tab 提取文章
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tabs[0]?.id) throw new Error('No active tab found')

        const results = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => {
            // 这个函数在页面上下文执行
            // extractArticle 是全局函数（由 content script 注入）
            const extractor = (window as any).extractArticle
            if (typeof extractor === 'function') {
              return extractor()
            }
            return null
          },
        })

        return results[0]?.result || null
      }

      case 'uploadImage': {
        const imageData = params?.imageData as string
        const mimeType = params?.mimeType as string
        const platform = (params?.platform as string) || 'weibo'

        if (!imageData) throw new Error('Missing imageData parameter')
        if (!mimeType) throw new Error('Missing mimeType parameter')

        // 获取适配器
        const adapter = await getAdapter(platform)
        if (!adapter) {
          throw new Error(`Platform not found: ${platform}`)
        }

        // 检查适配器是否支持 base64 图片上传
        if (typeof (adapter as any).uploadImageBase64 !== 'function') {
          throw new Error(`Platform ${platform} does not support base64 image upload`)
        }

        // 上传图片
        const result = await (adapter as any).uploadImageBase64(imageData, mimeType)
        return {
          url: result.url,
          platform,
        }
      }

      default:
        throw new Error(`Unknown method: ${method}`)
    }
  }
}

// 单例
export const mcpClient = new McpClient()

// 启动连接（在 background 中调用）
export function startMcpClient(): void {
  mcpClient.connect()
}

// 停止连接
export function stopMcpClient(): void {
  mcpClient.disconnect()
}

// 获取连接状态
export function getMcpStatus(): { connected: boolean } {
  return { connected: mcpClient.isConnected() }
}
