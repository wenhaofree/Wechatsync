/**
 * 掘金适配器
 */
import { CodeAdapter, type ImageUploadResult, htmlToMarkdown } from '@wechatsync/core'
import type { Article, AuthResult, SyncResult, PlatformMeta, PublishOptions } from '@wechatsync/core'
import { createLogger } from '../lib/logger'

const logger = createLogger('Juejin')

export class JuejinAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'juejin',
    name: '掘金',
    icon: 'https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/favicon-32x32.png',
    homepage: 'https://juejin.cn',
    capabilities: ['article', 'draft', 'image_upload', 'categories', 'tags', 'cover'],
  }

  private cachedCsrfToken: string | null = null

  async checkAuth(): Promise<AuthResult> {
    try {
      const response = await this.runtime.fetch('https://api.juejin.cn/user_api/v1/user/get', {
        method: 'GET',
        credentials: 'include',
      })

      const data = await response.json() as {
        data?: {
          user_id?: string
          user_name?: string
          avatar_large?: string
        }
      }

      if (data.data?.user_id) {
        return {
          isAuthenticated: true,
          userId: data.data.user_id,
          username: data.data.user_name,
          avatar: data.data.avatar_large,
        }
      }

      return { isAuthenticated: false }
    } catch (error) {
      logger.error('checkAuth error:', error)
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  /**
   * 获取 CSRF Token (参考 DSL juejin.transform.ts)
   */
  private async getCsrfToken(): Promise<string> {
    if (this.cachedCsrfToken) {
      return this.cachedCsrfToken
    }

    // 使用 runtime.fetch 以便 extension 能正确处理
    const response = await this.runtime.fetch('https://api.juejin.cn/user_api/v1/sys/token', {
      method: 'HEAD',
      headers: {
        'x-secsdk-csrf-request': '1',
        'x-secsdk-csrf-version': '1.2.10',
      },
      credentials: 'include',
    })

    const wareToken = response.headers.get('x-ware-csrf-token')
    if (!wareToken) {
      logger.warn('CSRF token not found in response headers')
      throw new Error('Failed to get CSRF token')
    }

    // Token 格式: "0,{actual_token},86370000,success,{session_id}"
    const parts = wareToken.split(',')
    if (parts.length < 2) {
      throw new Error('Invalid CSRF token format')
    }

    this.cachedCsrfToken = parts[1]
    logger.debug('Got CSRF token:', this.cachedCsrfToken.substring(0, 10) + '...')
    return this.cachedCsrfToken
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    try {
      logger.info('Starting publish...')

      // 1. 获取 CSRF token
      const csrfToken = await this.getCsrfToken()

      // 2. 获取 HTML 内容
      const rawHtml = article.html || article.markdown

      // 3. 清理 HTML
      let content = this.cleanHtml(rawHtml, {
        removeIframes: true,
        removeSvgImages: true,
        removeTags: ['mpprofile', 'qqmusic'],
        removeAttrs: ['data-reader-unique-id'],
      })

      // 4. 处理图片
      content = await this.processImages(
        content,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: [
            'juejin.cn', 'p1-juejin', 'p3-juejin',
            'p6-juejin', 'p9-juejin', 'byteimg.com'
          ],
          onProgress: options?.onImageProgress,
        }
      )

      // 5. 转换为 Markdown (掘金使用 Markdown)
      const markdown = htmlToMarkdown(content)

      // 6. 创建草稿 (参数来自 DSL juejin.yaml + juejin.transform.ts prepareBody)
      const createResponse = await this.runtime.fetch(
        'https://api.juejin.cn/content_api/v1/article_draft/create',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-secsdk-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            brief_content: '',
            category_id: '0',
            cover_image: '',
            edit_type: 10,
            html_content: 'deprecated',
            link_url: '',
            mark_content: markdown,
            tag_ids: [],
            title: article.title,
          }),
        }
      )

      // 检查响应状态和内容
      const responseText = await createResponse.text()
      logger.debug('Create draft response:', createResponse.status, responseText.substring(0, 300))

      if (!createResponse.ok) {
        throw new Error(`创建草稿失败: ${createResponse.status} - ${responseText}`)
      }

      let createData: { data?: { id?: string }; err_msg?: string; err_no?: number }
      try {
        createData = JSON.parse(responseText)
      } catch {
        throw new Error(`创建草稿失败: 响应不是有效 JSON - ${responseText.substring(0, 100)}`)
      }

      // 检查业务错误
      if (createData.err_no && createData.err_no !== 0) {
        throw new Error(createData.err_msg || `创建草稿失败: 错误码 ${createData.err_no}`)
      }

      if (!createData.data?.id) {
        throw new Error(createData.err_msg || '创建草稿失败: 无效响应')
      }

      const draftId = createData.data.id
      logger.debug('Draft created:', draftId)

      const draftUrl = `https://juejin.cn/editor/drafts/${draftId}`

      return this.createResult(true, {
        postId: draftId,
        postUrl: draftUrl,
        draftOnly: options?.draftOnly ?? true,
      })
    } catch (error) {
      return this.createResult(false, {
        error: (error as Error).message,
      })
    }
  }

  /**
   * 通过 Blob 上传图片（覆盖基类方法）
   */
  async uploadImage(file: Blob, _filename?: string): Promise<string> {
    return this.uploadImageBinaryInternal(file)
  }

  /**
   * 通过 URL 上传图片
   * 支持远程 URL 和 data URI
   */
  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    try {
      // 检测 data URI，使用二进制上传
      if (src.startsWith('data:')) {
        logger.debug('Detected data URI, using binary upload')
        const blob = await fetch(src).then(r => r.blob())
        const url = await this.uploadImageBinaryInternal(blob)
        return { url }
      }

      // 远程 URL 使用掘金 URL 上传 API
      const response = await this.runtime.fetch('https://juejin.cn/image/urlSave', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: src }),
        credentials: 'include',
      })

      const data = await response.json() as {
        data?: string
        message?: string
        err_msg?: string
        err_no?: number
      }

      // 检查错误
      if (data.err_no && data.err_no !== 0) {
        logger.warn('Upload failed:', data.err_msg || data.message)
        return { url: src } // 失败时返回原 URL
      }

      if (data.data) {
        logger.debug('Uploaded image by URL:', src.substring(0, 50), '->', data.data)
        return { url: data.data }
      }

      // 无数据返回原 URL
      logger.warn('Upload returned no data')
      return { url: src }
    } catch (error) {
      logger.warn('Failed to upload image by URL:', src, error)
      return { url: src } // 失败时返回原 URL
    }
  }

  /**
   * 上传图片 (二进制方式) - 内部使用
   */
  private async uploadImageBinaryInternal(file: Blob): Promise<string> {
    const csrfToken = await this.getCsrfToken()

    const formData = new FormData()
    formData.append('file', file)

    const response = await this.runtime.fetch('https://api.juejin.cn/content_api/v1/upload/image', {
      method: 'POST',
      headers: {
        'x-secsdk-csrf-token': csrfToken,
      },
      body: formData,
      credentials: 'include',
    })

    const data = await response.json() as {
      data?: { url?: string }
      err_msg?: string
    }

    if (!data.data?.url) {
      throw new Error(data.err_msg || 'Failed to upload image')
    }

    return data.data.url
  }

  /**
   * 获取分类列表
   */
  async getCategories() {
    const response = await this.runtime.fetch(
      'https://api.juejin.cn/tag_api/v1/query_category_briefs',
      {
        method: 'GET',
        credentials: 'include',
      }
    )

    const data = await response.json() as {
      data?: Array<{ category_id: string; category_name: string }>
    }

    // 转换为标准 Category 格式
    return (data.data || []).map(c => ({
      id: c.category_id,
      name: c.category_name,
    }))
  }
}
