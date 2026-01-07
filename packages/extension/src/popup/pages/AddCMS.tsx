import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Globe, ExternalLink } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { useCMSStore, type CMSType } from '../stores/cms'
import { trackPageView, trackPlatformExpansion } from '../../lib/analytics'

interface CMSOption {
  id: CMSType
  name: string
  description: string
  icon: string
}

const cmsOptions: CMSOption[] = [
  {
    id: 'wordpress',
    name: 'WordPress',
    description: '支持 XML-RPC 或 REST API',
    icon: 'https://s.w.org/style/images/about/WordPress-logotype-simplified.png',
  },
  {
    id: 'typecho',
    name: 'Typecho',
    description: '支持 XML-RPC 接口',
    icon: '/assets/typecho.ico',
  },
  {
    id: 'metaweblog',
    name: 'MetaWeblog API',
    description: '通用博客接口协议（博客园等）',
    icon: 'https://www.cnblogs.com/favicon.ico',
  },
]

// 支持的第三方平台列表
const supportedPlatforms = [
  { name: '知乎', url: 'https://www.zhihu.com', icon: 'https://static.zhihu.com/heifetz/favicon.ico' },
  { name: '掘金', url: 'https://juejin.cn', icon: 'https://lf3-cdn-tos.bytescm.com/obj/static/xitu_juejin_web/static/favicons/favicon-32x32.png' },
  { name: 'CSDN', url: 'https://blog.csdn.net', icon: 'https://g.csdnimg.cn/static/logo/favicon32.ico' },
  { name: '今日头条', url: 'https://mp.toutiao.com', icon: 'https://sf1-cdn-tos.toutiaostatic.com/obj/ttfe/pgcfe/sz/mp_logo.png' },
  { name: '百家号', url: 'https://baijiahao.baidu.com', icon: 'https://pic.rmb.bdstatic.com/10aborede5e85e725f488058cae625571c56.png' },
  { name: 'B站专栏', url: 'https://member.bilibili.com/article-text/home', icon: 'https://www.bilibili.com/favicon.ico' },
  { name: '微博', url: 'https://weibo.com', icon: 'https://weibo.com/favicon.ico' },
  { name: '搜狐号', url: 'https://mp.sohu.com', icon: 'https://mp.sohu.com/favicon.ico' },
  { name: '语雀', url: 'https://www.yuque.com', icon: 'https://mdn.alipayobjects.com/huamei_0prmtq/afts/img/A*vMxOQIh4KBMAAAAAAAAAAAAADvuFAQ/original' },
  { name: '雪球', url: 'https://xueqiu.com', icon: 'https://xueqiu.com/favicon.ico' },
  { name: '人人都是PM', url: 'https://www.woshipm.com', icon: 'https://www.woshipm.com/favicon.ico' },
  { name: '豆瓣', url: 'https://www.douban.com', icon: 'https://www.douban.com/favicon.ico' },
]

export function AddCMSPage() {
  const navigate = useNavigate()
  const { addAccount } = useCMSStore()
  const [step, setStep] = useState<'select' | 'config'>('select')
  const [selectedCMS, setSelectedCMS] = useState<CMSType | null>(null)
  const [config, setConfig] = useState({
    url: '',
    username: '',
    password: '',
    name: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 追踪页面访问
  useEffect(() => {
    trackPageView('add_cms').catch(() => {})
  }, [])

  const handleSelectCMS = (cmsId: CMSType) => {
    setSelectedCMS(cmsId)
    setStep('config')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await addAccount({
        type: selectedCMS!,
        name: config.name,
        url: config.url,
        username: config.username,
        password: config.password,
      })

      if (result.success) {
        // 追踪平台扩展（获取当前 CMS 账户数量）
        chrome.storage.local.get('cmsAccounts').then((storage) => {
          const total = (storage.cmsAccounts || []).length
          trackPlatformExpansion(`cms_${selectedCMS}`, total).catch(() => {})
        })
        navigate('/')
      } else {
        setError(result.error || '添加失败')
      }
    } catch (err) {
      setError((err as Error).message)
    }

    setLoading(false)
  }

  return (
    <div className="p-4">
      {/* 返回按钮 */}
      <button
        onClick={() => (step === 'config' ? setStep('select') : navigate('/'))}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        返回
      </button>

      {step === 'select' && (
        <div className="space-y-6">
          {/* 自建站点 */}
          <div>
            <h2 className="text-lg font-semibold mb-1">自建站点</h2>
            <p className="text-xs text-muted-foreground mb-3">
              添加你的博客系统
            </p>

            <div className="space-y-2">
              {cmsOptions.map(cms => (
                <button
                  key={cms.id}
                  onClick={() => handleSelectCMS(cms.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border hover:border-primary transition-colors text-left"
                >
                  <img
                    src={cms.icon}
                    alt={cms.name}
                    className="w-8 h-8 rounded"
                    onError={e => {
                      (e.target as HTMLImageElement).src = '/assets/icon-48.png'
                    }}
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{cms.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {cms.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 第三方平台 */}
          <div>
            <h2 className="text-lg font-semibold mb-1">第三方平台</h2>
            <p className="text-xs text-muted-foreground mb-3">
              点击前往登录，登录后自动识别
            </p>

            <div className="grid grid-cols-4 gap-2">
              {supportedPlatforms.map(platform => (
                <button
                  key={platform.name}
                  onClick={() => chrome.tabs.create({ url: platform.url })}
                  className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-muted transition-colors"
                  title={`前往 ${platform.name} 登录`}
                >
                  <img
                    src={platform.icon}
                    alt={platform.name}
                    className="w-6 h-6 rounded"
                    onError={e => {
                      (e.target as HTMLImageElement).src = '/assets/icon-48.png'
                    }}
                  />
                  <span className="text-[10px] text-muted-foreground truncate w-full text-center">
                    {platform.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 'config' && selectedCMS && (
        <>
          <h2 className="text-lg font-semibold mb-1">
            配置 {cmsOptions.find(c => c.id === selectedCMS)?.name}
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            输入站点信息以连接
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">站点名称</label>
              <input
                type="text"
                value={config.name}
                onChange={e => setConfig({ ...config, name: e.target.value })}
                placeholder="我的博客"
                className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">站点地址</label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="url"
                  value={config.url}
                  onChange={e => setConfig({ ...config, url: e.target.value })}
                  placeholder="https://example.com"
                  className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">用户名</label>
              <input
                type="text"
                value={config.username}
                onChange={e => setConfig({ ...config, username: e.target.value })}
                placeholder="admin"
                className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">密码</label>
              <input
                type="password"
                value={config.password}
                onChange={e => setConfig({ ...config, password: e.target.value })}
                placeholder="••••••••"
                className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                密码仅存储在本地，不会上传到任何服务器
              </p>
            </div>

            {error && (
              <div className="text-sm text-red-500 bg-red-50 p-2 rounded">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '连接中...' : '添加站点'}
            </Button>
          </form>
        </>
      )}
    </div>
  )
}
