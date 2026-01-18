/**
 * 慕课网手记适配器
 * https://www.imooc.com
 */
import { CodeAdapter, ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, SyncResult, PlatformMeta } from '../../types'
export class ImoocAdapter extends CodeAdapter {
  meta: PlatformMeta = {
    id: 'imooc',
    name: '慕课手记',
    icon: 'https://www.imooc.com/favicon.ico',
    homepage: 'https://www.imooc.com/article',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  // Header 规则 ID
  private headerRuleId: string | null = null

  /**
   * 添加 Header 规则
   */
  private async addHeaderRules(): Promise<void> {
    if (!this.runtime.headerRules) return

    this.headerRuleId = await this.runtime.headerRules.add({
      urlFilter: '*://www.imooc.com/article/*',
      headers: {
        Origin: 'https://www.imooc.com',
        Referer: 'https://www.imooc.com/',
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
      await this.addHeaderRules()

      const response = await this.runtime.fetch('https://www.imooc.com/u/card', {
        credentials: 'include',
      })
      let text = await response.text()

      // 解析 JSONP 响应
      text = text.replace('jsonpcallback(', '').replace('})', '}')
      const result = JSON.parse(text)

      await this.removeHeaderRules()

      if (result.result !== 0) {
        return { isAuthenticated: false, error: result.msg || '未登录' }
      }

      return {
        isAuthenticated: true,
        userId: result.data.uid,
        username: result.data.nickname,
        avatar: result.data.img,
      }
    } catch (error) {
      await this.removeHeaderRules()
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  /**
   * 上传图片
   */
  async uploadImageByUrl(url: string): Promise<ImageUploadResult> {
    // 下载图片
    const imageResponse = await this.runtime.fetch(url)
    const blob = await imageResponse.blob()

    // 构建 FormData
    const formData = new FormData()
    const filename = `${Date.now()}.jpg`
    const file = new File([blob], filename, { type: blob.type || 'image/jpeg' })

    formData.append('photo', file, filename)
    formData.append('type', file.type)
    formData.append('id', 'WU_FILE_0')
    formData.append('name', filename)
    formData.append('lastModifiedDate', new Date().toString())
    formData.append('size', String(file.size))

    const response = await this.runtime.fetch(
      'https://www.imooc.com/article/ajaxuploadimg',
      {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }
    )

    const res = await response.json()

    if (res.result !== 0) {
      throw new Error(res.msg || '图片上传失败')
    }

    // 处理协议相对 URL
    let imgUrl = res.data.imgpath
    if (imgUrl.startsWith('//')) {
      imgUrl = 'https:' + imgUrl
    }

    return { url: imgUrl }
  }

  /**
   * 发布文章
   */
  async publish(article: Article): Promise<SyncResult> {
    const now = Date.now()
    try {
      await this.addHeaderRules()

      // 优先使用 markdown，处理图片
      let content = article.markdown || article.html || ''
      content = await this.processImages(content, (src) => this.uploadImageByUrl(src))

      const response = await this.runtime.fetch('https://www.imooc.com/article/savedraft', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          editor: '0',
          draft_id: '0',
          title: article.title,
          content: content,
        }),
      })

      const res = await response.json()
      await this.removeHeaderRules()

      if (!res.data) {
        throw new Error('发布失败')
      }

      return {
        platform: this.meta.id,
        success: true,
        postId: res.data,
        postUrl: `https://www.imooc.com/article/draft/id/${res.data}`,
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
