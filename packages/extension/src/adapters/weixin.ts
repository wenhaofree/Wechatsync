/**
 * 微信公众号适配器
 */
import { CodeAdapter, type ImageUploadResult, markdownToHtml } from '@wechatsync/core'
import type { Article, AuthResult, SyncResult, PlatformMeta } from '@wechatsync/core'
import type { PublishOptions } from '@wechatsync/core'
import juice from 'juice'
import { createLogger } from '../lib/logger'

const logger = createLogger('Weixin')

interface WeixinCommonData {
  user_name: string
  nick_name: string
  t: string // token
  ticket: string
  time: number
}

interface WeixinMeta {
  token: string
  userName: string
  nickName: string
  ticket: string
  svrTime: number
  avatar: string
}

// 微信公众号的默认 CSS 样式
const WEIXIN_CSS = `
p {
  color: rgb(51, 51, 51);
  font-size: 15px;
  line-height: 1.75em;
  margin: 0 0 1em 0;
}
h1, h2, h3, h4, h5, h6 {
  font-weight: bold;
}
h1 { font-size: 1.25em; line-height: 1.4em; margin: 1em 0 0.5em 0; }
h2 { font-size: 1.125em; margin: 1em 0 0.5em 0; }
h3 { font-size: 1.05em; margin: 0.8em 0 0.4em 0; }
h4, h5, h6 { font-size: 1em; margin: 0.8em 0 0.4em 0; }
li p { margin: 0; }
ul, ol { margin: 1em 0; padding-left: 2em; }
li { margin-bottom: 0.4em; }
pre, tt, code, kbd, samp { font-family: monospace; }
pre { white-space: pre; margin: 1em 0; }
blockquote { border-left: 4px solid #ddd; padding-left: 1em; margin: 1em 0; color: #666; }
hr { border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }
i, cite, em, var, address { font-style: italic; }
b, strong { font-weight: bolder; }
`

export class WeixinAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'weixin',
    name: '微信公众号',
    icon: 'https://mp.weixin.qq.com/favicon.ico',
    homepage: 'https://mp.weixin.qq.com',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  private weixinMeta: WeixinMeta | null = null

  async checkAuth(): Promise<AuthResult> {
    try {
      const response = await this.runtime.fetch(
        'https://mp.weixin.qq.com/',
        {
          method: 'GET',
          credentials: 'include',
        }
      )

      const html = await response.text()

      // MV3 不支持 new Function()，使用正则提取关键值
      // 提取 token: t: "1573005921" || "1573005921"
      const tokenMatch = html.match(/data:\s*\{[\s\S]*?t:\s*["']([^"']+)["']/)
      if (!tokenMatch) {
        logger.debug(' No token found')
        return { isAuthenticated: false }
      }

      // 提取其他字段
      const ticketMatch = html.match(/ticket:\s*["']([^"']+)["']/)
      const userNameMatch = html.match(/user_name:\s*["']([^"']+)["']/)
      const nickNameMatch = html.match(/nick_name:\s*["']([^"']+)["']/)
      const timeMatch = html.match(/time:\s*["'](\d+)["']/)
      const headImgMatch = html.match(/head_img:\s*['"]([^'"]+)['"]/)

      // 提取头像 - 优先从页面元素获取
      const avatarMatch = html.match(/class="weui-desktop-account__thumb"[^>]*src="([^"]+)"/)
      let avatar = avatarMatch ? avatarMatch[1] : (headImgMatch ? headImgMatch[1] : '')
      if (avatar.startsWith('http://')) {
        avatar = avatar.replace('http://', 'https://')
      }

      this.weixinMeta = {
        token: tokenMatch[1],
        userName: userNameMatch ? userNameMatch[1] : '',
        nickName: nickNameMatch ? nickNameMatch[1] : '',
        ticket: ticketMatch ? ticketMatch[1] : '',
        svrTime: timeMatch ? Number(timeMatch[1]) : Date.now() / 1000,
        avatar,
      }

      logger.debug(' Auth info:', {
        userName: this.weixinMeta.userName,
        nickName: this.weixinMeta.nickName,
        hasToken: !!this.weixinMeta.token,
      })

      return {
        isAuthenticated: true,
        userId: this.weixinMeta.userName,
        username: this.weixinMeta.nickName,
        avatar: this.weixinMeta.avatar,
      }
    } catch (error) {
      logger.error(' checkAuth error:', error)
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    try {
      logger.info('Starting publish...')

      // 1. 确保已登录
      if (!this.weixinMeta) {
        const auth = await this.checkAuth()
        if (!auth.isAuthenticated) {
          throw new Error('请先登录微信公众号')
        }
      }

      // 2. 获取 HTML 内容
      // 优先使用原始 HTML（保留样式），否则从 Markdown 转换
      const rawHtml = article.html || markdownToHtml(article.markdown)

      // 3. 清理内容
      let content = this.cleanHtml(rawHtml, {
        removeIframes: true,
        removeSvgImages: true,
        removeTags: ['qqmusic'],
        removeAttrs: ['data-reader-unique-id', '_src'],
      })

      // 4. 处理 LaTeX 公式（转成图片，放在图片处理之前）
      content = this.processLatex(content)

      // 5. 处理图片（包括 LaTeX 生成的图片）
      content = await this.processImages(
        content,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn'],
          onProgress: options?.onImageProgress,
        }
      )

      // 6. 处理内容格式（内联 CSS）
      content = this.processContent(content)

      // 6. 创建草稿
      const formData = new URLSearchParams({
        token: this.weixinMeta!.token,
        lang: 'zh_CN',
        f: 'json',
        ajax: '1',
        random: String(Math.random()),
        AppMsgId: '',
        count: '1',
        data_seq: '0',
        operate_from: 'Chrome',
        isnew: '0',
        ad_video_transition0: '',
        can_reward0: '0',
        related_video0: '',
        is_video_recommend0: '-1',
        title0: article.title,
        author0: '',
        writerid0: '0',
        fileid0: '',
        digest0: '',
        auto_gen_digest0: '1',
        content0: content,
        sourceurl0: '',
        need_open_comment0: '1',
        only_fans_can_comment0: '0',
        cdn_url0: '',
        cdn_235_1_url0: '',
        cdn_1_1_url0: '',
        cdn_url_back0: '',
        crop_list0: '',
        music_id0: '',
        video_id0: '',
        voteid0: '',
        voteismlt0: '',
        supervoteid0: '',
        cardid0: '',
        cardquantity0: '',
        cardlimit0: '',
        vid_type0: '',
        show_cover_pic0: '0',
        shortvideofileid0: '',
        copyright_type0: '0',
        releasefirst0: '',
        platform0: '',
        reprint_permit_type0: '',
        allow_reprint0: '',
        allow_reprint_modify0: '',
        original_article_type0: '',
        ori_white_list0: '',
        free_content0: '',
        fee0: '0',
        ad_id0: '',
        guide_words0: '',
        is_share_copyright0: '0',
        share_copyright_url0: '',
        source_article_type0: '',
        reprint_recommend_title0: '',
        reprint_recommend_content0: '',
        share_page_type0: '0',
        share_imageinfo0: '{"list":[]}',
        share_video_id0: '',
        dot0: '{}',
        share_voice_id0: '',
        insert_ad_mode0: '',
        categories_list0: '[]',
      })

      const response = await this.runtime.fetch(
        `https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=${this.weixinMeta!.token}&lang=zh_CN`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData,
        }
      )

      const res = await response.json() as {
        appMsgId?: string
        ret?: number
        base_resp?: { ret: number; err_msg?: string }
      }

      logger.debug(' Save response:', res)

      if (!res.appMsgId) {
        const errMsg = this.formatError(res)
        throw new Error(errMsg)
      }

      const draftUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=${res.appMsgId}&token=${this.weixinMeta!.token}&lang=zh_CN`

      return this.createResult(true, {
        postId: res.appMsgId,
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
   * 通过 URL 上传图片（先下载再上传）
   */
  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    if (!this.weixinMeta) {
      throw new Error('未登录')
    }

    // 1. 下载图片
    const imageResponse = await fetch(src)
    if (!imageResponse.ok) {
      throw new Error('图片下载失败: ' + src)
    }
    const imageBlob = await imageResponse.blob()

    // 2. 构建 FormData
    const formData = new FormData()
    const timestamp = Date.now()
    const fileName = `${timestamp}.jpg`

    formData.append('type', imageBlob.type || 'image/jpeg')
    formData.append('id', String(timestamp))
    formData.append('name', fileName)
    formData.append('lastModifiedDate', new Date().toString())
    formData.append('size', String(imageBlob.size))
    formData.append('file', imageBlob, fileName)

    // 3. 上传到微信
    const { token, userName, ticket, svrTime } = this.weixinMeta
    const seq = Date.now()

    const response = await this.runtime.fetch(
      `https://mp.weixin.qq.com/cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite&groupid=1&ticket_id=${userName}&ticket=${ticket}&svr_time=${svrTime}&token=${token}&lang=zh_CN&seq=${seq}&t=${Math.random()}`,
      {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }
    )

    const res = await response.json() as {
      cdn_url?: string
      content?: string
      base_resp?: { err_msg: string; ret: number }
    }

    logger.debug(' Image upload response:', res)

    if (res.base_resp?.err_msg !== 'ok' || !res.cdn_url) {
      throw new Error('图片上传失败: ' + src)
    }

    return {
      url: res.cdn_url,
    }
  }

  /**
   * 检查内容是否是 LaTeX 公式（而非货币符号等）
   * LaTeX 公式通常包含: \ ^ _ { } 或希腊字母等
   */
  private isLatexFormula(text: string): boolean {
    // 包含 LaTeX 命令字符
    if (/[\\^_{}]/.test(text)) return true
    // 包含希腊字母 (Unicode)
    if (/[α-ωΑ-Ω]/.test(text)) return true
    // 包含常见数学符号
    if (/[∑∏∫∂∇∞≠≤≥±×÷√]/.test(text)) return true
    return false
  }

  /**
   * 处理 LaTeX 公式，转换为图片
   * 微信公众号不支持 JS 渲染，需要用图片展示公式
   * 使用 PNG 格式（SVG 会被 cleanHtml 清理）
   */
  private processLatex(content: string): string {
    const LATEX_API = 'https://latex.codecogs.com/png.latex'

    // 块级公式 $$...$$ 转成居中图片
    content = content.replace(/\$\$([^$]+)\$\$/g, (match, latex) => {
      if (!this.isLatexFormula(latex)) return match // 不是 LaTeX，保持原样
      const encoded = encodeURIComponent(latex.trim())
      return `<p style="text-align: center;"><img src="${LATEX_API}?\\dpi{150}${encoded}" alt="formula" style="vertical-align: middle; max-width: 100%;"></p>`
    })

    // 行内公式 $...$ 转成内联图片
    content = content.replace(/\$([^$]+)\$/g, (match, latex) => {
      if (!this.isLatexFormula(latex)) return match // 不是 LaTeX，保持原样
      const encoded = encodeURIComponent(latex.trim())
      return `<img src="${LATEX_API}?\\dpi{120}${encoded}" alt="formula" style="vertical-align: middle;">`
    })

    return content
  }

  /**
   * 处理内容格式
   */
  private processContent(content: string): string {
    // 包装内容
    const wrapped = `<section style="margin-left: 6px; margin-right: 6px; line-height: 1.75em;">${content}</section>`

    // 使用 juice 内联 CSS
    return juice.inlineContent(wrapped, WEIXIN_CSS)
  }

  /**
   * 格式化错误信息
   */
  private formatError(res: any): string {
    const ret = res.ret ?? res.base_resp?.ret

    const errorMap: Record<number, string> = {
      [-6]: '请输入验证码',
      [-8]: '请输入验证码',
      [-1]: '系统错误，请注意备份内容后重试',
      [-2]: '参数错误，请注意备份内容后重试',
      [-5]: '服务错误，请注意备份内容后重试',
      [-99]: '内容超出字数，请调整',
      [-206]: '服务负荷过大，请稍后重试',
      [200002]: '参数错误，请注意备份内容后重试',
      [200003]: '登录态超时，请重新登录',
      [412]: '图文中含非法外链',
      [62752]: '可能含有具备安全风险的链接，请检查',
      [64502]: '你输入的微信号不存在',
      [64505]: '发送预览失败，请稍后再试',
      [64506]: '保存失败，链接不合法',
      [64507]: '内容不能包含外部链接',
      [64509]: '正文中不能包含超过3个视频',
      [64515]: '当前素材非最新内容，请重新打开并编辑',
      [64702]: '标题超出64字长度限制',
      [64703]: '摘要超出120字长度限制',
      [64705]: '内容超出字数，请调整',
      [10806]: '正文不能有违规内容，请重新编辑',
      [10807]: '内容不能违反公众平台协议',
      [220001]: '素材管理中的存储数量已达上限',
      [220002]: '图片库已达到存储上限',
    }

    return errorMap[ret] || `同步失败 (错误码: ${ret})`
  }
}
