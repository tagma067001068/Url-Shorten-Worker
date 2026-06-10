# R2 对象存储 文件保管站 — 新手搭建手册

> 本项目基于 [Url-Shorten-Worker](https://github.com/crazypeace/Url-Shorten-Worker)，利用 Cloudflare Workers + R2 对象存储 + KV，搭建一个**完全免费**的文件托管站点。  
> 用户通过网页上传文件，文件存储在 R2 中，通过短链接访问，302 重定向到 R2 公开 URL。

---

## 目录

1. [它能做什么](#1-它能做什么)
2. [你需要准备什么](#2-你需要准备什么)
3. [第一步：Fork 代码仓库](#3-第一步fork-代码仓库)
4. [第二步：创建 R2 存储桶](#4-第二步创建-r2-存储桶)
5. [第三步：开启 R2 公开访问](#5-第三步开启-r2-公开访问)
6. [第四步：创建 S3 API 凭证](#6-第四步创建-s3-api-凭证)
7. [第五步：创建 Workers KV 命名空间](#7-第五步创建-workers-kv-命名空间)
8. [第六步：创建 Worker 并部署代码](#8-第六步创建-worker-并部署代码)
9. [第七步：配置环境变量](#9-第七步配置环境变量)
10. [第八步：绑定 KV 和自定义域名](#10-第八步绑定-kv-和自定义域名)
11. [第九步：设置密码并访问](#11-第九步设置密码并访问)
12. [使用方法](#12-使用方法)
13. [进阶：自定义域名绑定 R2](#13-进阶自定义域名绑定-r2)
14. [进阶：图片缩略图预览](#14-进阶图片缩略图预览)
15. [进阶：Fork 后独立维护](#15-进阶fork-后独立维护)
16. [费用说明](#16-费用说明)
17. [常见问题](#17-常见问题)

---

## 1. 它能做什么

```
浏览器 ──上传文件──▶ Worker ──presigned URL──▶ R2 存储桶
                                        │
                        KV 记录: 短链名 → R2 公开 URL
                                        │
访问者 ──点击短链──▶ Worker ──查 KV ──302 重定向──▶ R2 公开 URL 下载文件
```

- ✅ 文件直接上传到 R2（不经过 Worker，节省 Workers 请求额度）
- ✅ 短链接访问，302 跳转到 R2 公开地址
- ✅ 自定义短链名称（如 `myfile.pdf`）
- ✅ 图片文件自动缩略图预览
- ✅ 管理面板可查看/删除已上传文件
- ✅ 完全免费（在 Cloudflare 免费额度内）

---

## 2. 你需要准备什么

- **一个 Cloudflare 账号**（免费注册即可）
- **一个域名**，DNS 托管在 Cloudflare 上（用于 Worker 自定义域名和 R2 自定义域名）
- **一个 GitHub 账号**（用于 Fork 代码仓库）

> 💡 Cloudflare 免费计划就足够了，不需要付费。

---

## 3. 第一步：Fork 代码仓库

1. 打开 https://github.com/crazypeace/Url-Shorten-Worker
2. 点击右上角 **Fork** 按钮，Fork 到你自己的 GitHub 账号下
3. Fork 完成后，你有了自己的副本：`https://github.com/你的用户名/Url-Shorten-Worker`

---

## 4. 第二步：创建 R2 存储桶

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧菜单找到 **R2 对象存储**
3. 点击 **创建存储桶**
4. 填写存储桶名称，例如 `my-file-hosting`
5. 选择位置：**自动（推荐）**
6. 点击 **创建存储桶**

记下你的 **存储桶名称**，后面要用。

---

## 5. 第三步：开启 R2 公开访问

1. 进入你刚创建的 R2 存储桶
2. 点击 **设置** 标签
3. 找到 **公开访问** 部分
4. 点击 **允许访问**，确认开启
5. 开启后会显示一个公开 URL，格式类似：
   ```
   https://pub-xxxxxxxxxxxx.r2.dev
   ```
6. **记下这个 URL**，后面配置要用

> 💡 这个 `r2.dev` 域名是 Cloudflare 自动分配的，免费可用。后面进阶部分会讲如何绑定自定义域名。

---

## 6. 第四步：创建 S3 API 凭证

Worker 需要通过 S3 API 生成预签名上传链接，所以需要 R2 的 API 凭证。

1. 在 R2 页面，点击右上角 **管理 R2 API 令牌**
2. 点击 **创建 API 令牌**
3. 配置：
   - **令牌名称**：随便起，比如 `file-hosting-token`
   - **权限**：选择 **对象读和写**
   - **指定存储桶**：选择你刚创建的那个桶（如 `my-file-hosting`）
   - **客户端 IP 过滤**：留空（不限制）
   - **TTL**：留空（永不过期）
4. 点击 **创建 API 令牌**
5. **⚠️ 立即复制并保存以下信息**（页面关闭后无法再查看！）：
   - **Access Key ID**
   - **Secret Access Key**

同时记下你的 **账户 ID**（在 R2 页面右侧的 "账户详情" 中可以看到）。

---

## 7. 第五步：创建 Workers KV 命名空间

KV 用来存储「短链名 → R2 URL」的映射关系。

1. 左侧菜单找到 **Workers 和 Pages**
2. 点击 **KV** 标签
3. 点击 **创建命名空间**
4. 填写名称，比如 `file-hosting-kv`
5. 点击 **添加**
6. **记下命名空间 ID**（一串十六进制字符串）

---

## 8. 第六步：创建 Worker 并部署代码

### 方式 A：通过 Cloudflare Dashboard 直接创建（推荐新手）

1. 左侧菜单 → **Workers 和 Pages**
2. 点击 **创建应用程序**
3. 点击 **创建 Worker**
4. 填写名称，比如 `file-hosting`，点击 **部署**
5. 部署完成后，点击 **编辑代码**
6. 删除编辑器中的默认代码
7. 打开你 Fork 的 GitHub 仓库中的 `worker.js` 文件，复制全部内容
8. **⚠️ 修改配置**：将代码顶部的 `config` 中的 `system_type` 改为 `"file-r2"`：
   ```javascript
   const config = {
     password: "",
     result_page: false,
     theme: "theme/file-r2",  // ← 必须改成这个！
     cors: true,
     custom_link: true,
     overwrite_kv: false,
     load_kv: true,           // ← 建议打开，方便管理面板加载全部文件列表
     system_type: "file-r2",  // ← 必须改成这个！
   }
   ```
9. 粘贴修改后的代码到 Cloudflare 编辑器
10. 点击 **保存并部署**

### 方式 B：使用 Wrangler CLI（适合有命令行经验的用户）

```bash
# 安装 wrangler
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 在 Fork 的仓库目录下创建 wrangler.toml
cd Url-Shorten-Worker
cat > wrangler.toml << 'EOF'
name = "file-hosting"
main = "worker.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "LINKS"
id = "你的KV命名空间ID"

[vars]
R2_ACCOUNT_ID = "你的账户ID"
R2_BUCKET_NAME = "你的存储桶名称"
R2_PUBLIC_URL = "https://pub-xxxxxxxx.r2.dev"
EOF

# 部署
wrangler deploy
```

---

## 9. 第七步：配置环境变量

这是最关键的一步！Worker 需要 5 个变量来连接 R2。

### 在 Cloudflare Dashboard 中配置：

1. 进入你的 Worker 页面 → **设置** → **变量和机密**
2. 点击 **添加变量**，逐个添加：

| 变量名 | 类型 | 值 | 说明 |
|--------|------|-----|------|
| `R2_ACCOUNT_ID` | 明文变量 | 你的 Cloudflare 账户 ID | 32位十六进制字符串 |
| `R2_BUCKET_NAME` | 明文变量 | 你的存储桶名称 | 如 `my-file-hosting` |
| `R2_PUBLIC_URL` | 明文变量 | R2 公开访问 URL | 如 `https://pub-xxxx.r2.dev` |
| `R2_ACCESS_KEY_ID` | **加密机密** | API 凭证的 Access Key ID | 第6步获取的 |
| `R2_SECRET_ACCESS_KEY` | **加密机密** | API 凭证的 Secret Access Key | 第6步获取的 |

> ⚠️ **重要**：`R2_ACCESS_KEY_ID` 和 `R2_SECRET_ACCESS_KEY` 请设置为「加密机密」（Secret），而不是普通变量！  
> 点击添加变量时，输入框右侧有一个 **加密** 开关，打开它。

---

## 10. 第八步：绑定 KV 和自定义域名

### 绑定 KV 命名空间：

1. Worker 页面 → **设置** → **绑定**
2. 点击 **添加绑定**
3. 类型选择 **KV 命名空间**
4. 变量名填 `LINKS`（⚠️ 必须是这个名字！代码中硬编码了 `LINKS`）
5. 选择你之前创建的 KV 命名空间
6. 保存

### 绑定自定义域名（推荐）：

用自定义域名比 `workers.dev` 域名更稳定，国内也能访问。

1. Worker 页面 → **设置** → **触发器**
2. 在 **自定义域** 部分，点击 **添加自定义域**
3. 输入一个子域名，比如 `files.你的域名.com`
4. Cloudflare 会自动配置 DNS，点击 **添加自定义域**
5. 等待 SSL 证书生效（通常 1-5 分钟）

---

## 11. 第九步：设置密码并访问

1. 部署完成后，通过自定义域名或 `workers.dev` 域名访问你的 Worker
2. 你会看到一个 **404 页面** —— 这是正常的！直接访问域名默认返回 404
3. **设置密码**：访问 `https://你的域名/你想设置的密码`，例如：
   ```
   https://files.你的域名.com/mypassword123
   ```
4. 首次访问会显示管理面板，系统会自动把这个 path 存入 KV 作为密码
5. 以后访问管理面板，就用这个 URL：
   ```
   https://files.你的域名.com/mypassword123
   ```

> 💡 密码就是 URL 的 path 部分，相当于一个「秘密入口」。知道这个 URL 的人才能进入管理面板。

---

## 12. 使用方法

### 上传文件：

1. 访问管理面板（你的密码 URL）
2. 左侧卡片 **「选择文件并上传到 R2」**：
   - 点击 **选择文件**，选择你要上传的文件
   - 点击 **上传到 R2** 按钮
   - 等待上传完成（有进度条显示）
3. 上传完成后，R2 URL 和文件名会自动填入右侧卡片
4. 你可以修改 **文件名 Key**（这就是短链的路径）
5. 点击 **保存到 KV** 按钮

### 访问文件：

- 上传成功后会弹出短链接，格式：`https://你的域名/文件名`
- 访问这个链接会自动 302 跳转到 R2 公开地址，浏览器直接下载/显示文件

### 管理文件：

- **LocalStorage List** 卡片中可以看到你上传过的文件列表
- 点击 **X** 按钮可以删除文件（同时删除 R2 中的文件和 KV 记录）
- 点击 **load KV to localStorage** 可以从 KV 加载全部文件列表
- 图片文件会自动显示缩略图预览

---

## 13. 进阶：自定义域名绑定 R2

默认的 `pub-xxxx.r2.dev` 域名可以工作，但如果你想用自己的域名（比如 `r2.你的域名.com`）来访问文件：

1. Cloudflare Dashboard → **R2** → 你的存储桶 → **设置**
2. 找到 **自定义域** 部分
3. 点击 **连接域**
4. 输入子域名，比如 `r2.你的域名.com`
5. Cloudflare 自动添加 DNS 记录
6. 生效后，把 Worker 环境变量中的 `R2_PUBLIC_URL` 改为：
   ```
   https://r2.你的域名.com
   ```
7. 重新部署 Worker

> 💡 使用自定义域名后，可以利用 Cloudflare 的 **Transformations** 功能做图片缩放。

---

## 14. 进阶：图片缩略图预览

如果你给 R2 绑定了自定义域名，并且域名开启了 Cloudflare 代理，可以使用 Cloudflare Image Transformations 生成缩略图。

修改 `theme/file-r2/main-r2.js` 中的配置：

```javascript
const IMG_RESIZE_BASE  = "https://r2.你的域名.com";  // 你的 R2 自定义域名
const IMG_PREVIEW_WIDTH = 200;                        // 缩略图宽度 (px)
```

这样在管理面板中，图片文件会自动显示压缩后的缩略图（节省流量）。

> 💡 Cloudflare Image Transformations 免费额度：每月 5000 次。

---

## 14b. 轻量版 file-r2-lite（无自动缩略图）

如果你不需要自动缩略图功能，可以使用 **file-r2-lite** 轻量版：

- ❌ 不自动加载缩略图（节省 R2 请求数）
- ✅ 图片/视频/音频/PDF 文件后面显示 **🔍 预览** 按钮
- ✅ 点击预览按钮后，从 localStorage 读取 R2 URL，弹窗显示预览
- ✅ 支持图片、视频、音频、PDF 等多种格式的内联预览

### 使用方法：

在 `worker.js` 的 config 中修改 theme：

```javascript
const config = {
  // ... 其他配置不变 ...
  theme: "theme/file-r2-lite",   // ← 轻量版
  system_type: "file-r2",        // ← 不变，复用同一个后端
}
```

### file-r2 vs file-r2-lite 对比：

| 特性 | file-r2 | file-r2-lite |
|------|---------|--------------|
| 自动缩略图 | ✅ 加载时自动显示 | ❌ 不显示 |
| 预览按钮 | ❌ 无 | ✅ 点击按需预览 |
| 支持格式 | 仅图片 | 图片/视频/音频/PDF |
| R2 请求数 | 多（每个图片条目都加载缩略图） | 少（仅点击时请求） |
| 适合场景 | 图片为主，需要一眼看到缩略图 | 文件类型多样，或想节省请求数 |
---

## 15. 进阶：Fork 后独立维护

如果你不想被上游仓库的更新影响：

1. 修改 `worker.js` 第 103 行，把 `crazypeace` 改为你的 GitHub 用户名：
   ```javascript
   let index_html = "https://你的用户名.github.io/Url-Shorten-Worker/" + config.theme + "/index.html"
   ```
2. 修改 `theme/file-r2/index.html`，把两处 `crazypeace` 改为你的 GitHub 用户名
3. 在你 Fork 的仓库中，进入 **Settings** → **Pages**，开启 GitHub Pages（Source 选 `main` 分支）

这样 Worker 就会从你自己的 GitHub Pages 加载前端页面，完全独立于上游。

---

## 16. 费用说明

Cloudflare 的免费额度非常慷慨，个人使用基本不会产生费用：

| 资源 | 免费额度 |
|------|---------|
| Workers 请求 | 每天 100,000 次 |
| KV 读取 | 每天 100,000 次 |
| KV 写入 | 每天 1,000 次 |
| R2 存储 | 10 GB |
| R2 Class A 操作（写入） | 每月 100 万次 |
| R2 Class B 操作（读取） | 每月 1000 万次 |
| R2 出口流量 | **免费（无出口费用）** |

> 💡 R2 最大的优势就是 **没有出口流量费**！下载文件再多次也不花钱。

---

## 17. 常见问题

### Q: 访问域名显示 404？
**A:** 这是正常的。直接访问域名（不带密码 path）默认返回 404。你需要访问带密码 path 的 URL 才能进入管理面板。

### Q: 上传失败，显示 "R2 上传失败"？
**A:** 检查以下几点：
- 环境变量是否全部正确设置（特别是 `R2_ACCOUNT_ID`）
- S3 API 凭证是否有 **对象读和写** 权限
- S3 API 凭证是否绑定了正确的存储桶
- `R2_PUBLIC_URL` 是否正确（注意结尾不要加 `/`）

### Q: 上传成功但访问短链接 404？
**A:** 检查 KV 绑定是否正确：
- 变量名必须是 `LINKS`（大写）
- KV 命名空间是否选择了正确的那个

### Q: "保存到 KV" 失败？
**A:** 可能是 KV 写入额度用完了（免费额度每天 1,000 次）。等第二天重置，或者检查密码是否正确。

### Q: 如何修改密码？
**A:** 在 Cloudflare Dashboard 中，进入你的 KV 命名空间，找到 `password` 这个 key，修改它的值。或者删除它，然后重新用新密码 path 访问。

### Q: 文件大小有限制吗？
**A:** R2 单个文件最大 5 GB。Worker 的 presigned URL 方式不经过 Worker 传输文件，所以不受 Workers 请求体大小限制。

### Q: 支持断点续传吗？
**A:** 前端使用 XMLHttpRequest 上传，不支持断点续传。大文件建议在稳定的网络环境下上传。

### Q: 能多人共用吗？
**A:** 可以，但要注意：
- KV 写入免费额度每天只有 1,000 次
- 所有人共用同一个密码
- 建议把 `config.load_kv` 设为 `false`，防止别人看到你的文件列表

---

## 附录：完整配置对照表

### worker.js 顶部 config 配置：

```javascript
const config = {
  password: "",                    // 留空，使用 KV 中的密码
  result_page: false,              // 不使用结果页面
  theme: "theme/file-r2",          // ⚠️ 必须是这个值
  cors: true,                      // 允许 CORS
  custom_link: true,               // 允许自定义短链名
  overwrite_kv: false,             // 不允许覆盖已存在的 key
  load_kv: true,                   // 允许加载全部 KV（自用推荐打开）
  system_type: "file-r2",          // ⚠️ 必须是这个值
}
```

### 环境变量：

```
R2_ACCOUNT_ID        = 32位账户ID
R2_ACCESS_KEY_ID     = S3 API Access Key（设为加密机密）
R2_SECRET_ACCESS_KEY = S3 API Secret Key（设为加密机密）
R2_BUCKET_NAME       = 你的存储桶名称
R2_PUBLIC_URL        = https://pub-xxxxx.r2.dev（或你的自定义域名）
```

### KV 绑定：

```
变量名: LINKS
命名空间: 你创建的那个 KV 命名空间
```

---

> 📖 项目地址：https://github.com/crazypeace/Url-Shorten-Worker  
> 🐛 遇到问题请提 Issue：https://github.com/crazypeace/Url-Shorten-Worker/issues
