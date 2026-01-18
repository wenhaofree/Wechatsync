# Changelog

## v2.0.3

### 🔧 核心修复

**同步 API 恢复**
- 新增 `inject-api.js` + `content/api.ts` - 网页端 `$syncer` API 兼容层
- 支持官网/第三方网站调用扩展功能

**代码块提取**
- 修复 `textContent` → `innerText`

**平台适配器修复**
- 开源中国 - 登录状态检测
- 人人都是产品经理 - 图片上传
- Typecho 

### 📝 文档
- ROADMAP 添加用户需求平台排名（基于 527 条反馈）

---

## v2.0.2

### 🌐 平台
- 新增 51CTO、慕课网、SegmentFault、开源中国 适配器

### 🔧 修复
- 新增 `Readability.js` + `reader.js` 文章提取库

---

## v2.0.1

### 🌐 平台
- 新增大鱼号适配器
- 搜狐号重新适配

### 🔧 稳定性
- 代码块格式保留（多行、语言标识）
- LaTeX 公式支持（`<script type="math/tex">` → Markdown）
- 表格格式优化（对齐标记、无表头 fallback、管道符转义）
- 错误提示优化

### 🐛 Bug 修复
- CSDN 图片上传
- CSDN 富文本编辑器冲突

---

## v2.0.0

### ✨ 全新架构
- Manifest V3 升级
- 全新 React UI
- 3 并发同步（速度 ~3x）
- 取消同步功能

### 🌐 平台支持
- 13 个平台适配：知乎、掘金、CSDN、今日头条、百家号、B站、微博、搜狐、语雀、雪球、人人PM、豆瓣、微信公众号

### 🔧 CMS 支持
- WordPress
- Typecho
- MetaWeblog 协议

### 📦 其他
- 兔小巢反馈入口
- v1.x 数据迁移
