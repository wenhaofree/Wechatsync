/**
 * 开源中国适配器
 * https://my.oschina.net
 */
import { CodeAdapter, ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, SyncResult, PlatformMeta } from '../../types'
export class OschinaAdapter extends CodeAdapter {
  meta: PlatformMeta = {
    id: 'oschina',
    name: '开源中国',
    icon: 'https://www.oschina.net/favicon.ico',
    homepage: 'https://my.oschina.net',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private userId: string | null = null
  private headerRuleId: string | null = null

  /**
   * 添加 Header 规则
   */
  private async addHeaderRules(): Promise<void> {
    if (!this.runtime.headerRules) return

    this.headerRuleId = await this.runtime.headerRules.add({
      urlFilter: '*://my.oschina.net/u/*',
      headers: {
        Origin: 'https://my.oschina.net',
        Referer: 'https://my.oschina.net/',
      },
    })
  }

  /**
   * 移除 Header 规则
   */
  private async removeHeaderRules(): Promise<void> {
    if (!this.runtime.headerRules) return

    if (this.headerRuleId) {
      await this.runtime.headerRules.remove(this.headerRuleId)
      this.headerRuleId = null
    }
  }

  /**
   * 检查登录状态
   */
  async checkAuth(): Promise<AuthResult> {
    try {
      const response = await this.runtime.fetch('https://www.oschina.net/blog', {
        credentials: 'include',
      })
      const html = await response.text()

      // 解析用户信息 - 匹配 current-user-avatar 元素
      const userIdMatch = html.match(/current-user-avatar[^>]*data-user-id="(\d+)"/)
      const avatarMatch = html.match(/current-user-avatar[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/)
      const nicknameMatch = html.match(/current-user-avatar[^>]*title="([^"]+)"/)

      if (!userIdMatch) {
        return { isAuthenticated: false, error: '未登录' }
      }

      this.userId = userIdMatch[1]

      return {
        isAuthenticated: true,
        userId: this.userId,
        username: nicknameMatch?.[1] || this.userId,
        avatar: avatarMatch?.[1],
      }
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  /**
   * 获取用户 token
   */
  private async getUserToken(): Promise<string> {
    if (!this.userId) {
      throw new Error('未登录')
    }

    const response = await this.runtime.fetch(
      `https://my.oschina.net/u/${this.userId}/blog/write`,
      { credentials: 'include' }
    )
    const html = await response.text()

    const tokenMatch = html.match(/data-name="g_user_code"[^>]*data-value="([^"]+)"/)
    if (!tokenMatch) {
      throw new Error('获取 token 失败')
    }

    return tokenMatch[1]
  }

  /**
   * 上传图片
   */
  async uploadImageByUrl(url: string): Promise<ImageUploadResult> {
    if (!this.userId) {
      await this.checkAuth()
    }

    // 下载图片
    const imageResponse = await this.runtime.fetch(url)
    const blob = await imageResponse.blob()

    // 构建 FormData
    const formData = new FormData()
    formData.append('editormd-image-file', blob)

    const response = await this.runtime.fetch(
      `https://my.oschina.net/u/${this.userId}/space/markdown_img_upload`,
      {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }
    )

    const res = await response.json()

    if (!res.url) {
      throw new Error('图片上传失败')
    }

    return { url: res.url }
  }

  /**
   * 发布文章
   */
  async publish(article: Article): Promise<SyncResult> {
    const now = Date.now()
    try {
      await this.addHeaderRules()

      // 确保已获取用户 ID
      if (!this.userId) {
        const auth = await this.checkAuth()
        if (!auth.isAuthenticated) {
          throw new Error('未登录')
        }
      }

      // 获取 user token
      const userToken = await this.getUserToken()

      // 优先使用 markdown，处理图片
      let content = article.markdown || article.html || ''
      content = await this.processImages(content, (src) => this.uploadImageByUrl(src))

      const response = await this.runtime.fetch(
        `https://my.oschina.net/u/${this.userId}/blog/save_draft`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            draft: '0',
            id: '',
            user_code: userToken,
            title: article.title,
            content: content,
            content_type: '3', // 3=markdown, 4=html
            catalog: '6680617',
            groups: '28',
            type: '1',
            origin_url: '',
            privacy: '0',
            deny_comment: '0',
            as_top: '0',
            downloadImg: '1',
            isRecommend: '0',
          }),
        }
      )

      const res = await response.json()
      await this.removeHeaderRules()

      if (res.code !== 1) {
        throw new Error(res.message || '发布失败')
      }

      const draftId = res.result.draft

      return {
        platform: this.meta.id,
        success: true,
        postId: draftId,
        postUrl: `https://my.oschina.net/u/${this.userId}/blog/write/draft/${draftId}`,
        draftOnly: true,
        timestamp: now,
      }
    } catch (error) {
      await this.removeHeaderRules()
      return {
        platform: this.meta.id,
        success: false,
        error: (error as Error).message,
        timestamp: now,
      }
    }
  }
}
