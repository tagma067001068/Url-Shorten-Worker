# File Hosting (R2) 部署操作手册

基于 [Url-Shorten-Worker](https://github.com/crazypeace/Url-Shorten-Worker) 的文件托管系统。

分两步部署：先部署 **file-r2-lite**（基础版），再升级为 **file-r2**（带缩略图预览）。

---

## 一、前置准备

### 1.1 创建 R2 存储桶

1. 进入 Cloudflare Dashboard → R2 Object Storage
2. 创建存储桶，例如 `filetrans`
3. 记下桶名备用

### 1.2 创建 R2 API Token

1. R2 页面 → 管理 R2 API Tokens → 创建 API Token
2. 权限：**对象读写**（Object Read & Write）
3. 指定刚才创建的存储桶
4. 记下：
   - **Access Key ID**
   - **Secret Access Key**
   - **Account ID**（在 R2 概览页右侧）

### 1.3 创建 KV 命名空间

1. 进入 Workers & Pages → KV
2. 创建命名空间，例如 `LINKS`
3. 记下命名空间名称备用

### 1.4 创建 Worker

1. 进入 Workers & Pages → 创建应用程序 → 创建 Worker
2. 命名，例如 `file-r2`
3. 先用默认代码创建，后面替换

---

## 二、部署 file-r2-lite（基础版）

### 2.1 配置 Worker 代码

在 Worker 编辑器中，用 `worker.js` 的内容替换默认代码，修改以下配置：

```js
const config = {
  password: "你的管理密码",    // 访问管理面板的密码
  custom_link: true,           // 允许自定义短链
  load_kv: true,               // 开启加载 KV 数据到前端
  system_type: "shorturl",     // 保持默认
}
```

### 2.2 绑定 KV

1. Worker 设置 → 变量 → KV 命名空间绑定
2. 变量名：`LINKS`
3. KV 命名空间：选择之前创建的

### 2.3 设置 R2 环境变量

Worker 设置 → 变量 → 环境变量（明文）：

| 变量名 | 值 |
|---|---|
| `R2_ACCOUNT_ID` | 你的 Account ID |
| `R2_BUCKET_NAME` | 你的桶名，如 `filetrans` |
| `R2_PUBLIC_URL` | R2 公开访问 URL，如 `https://pub-xxxx.r2.dev` |

Worker 设置 → 变量 → 密钥（加密）：

| 密钥名 | 值 |
|---|---|
| `R2_ACCESS_KEY_ID` | 你的 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | 你的 Secret Access Key |

### 2.4 配置 theme

编辑 `worker.js` 中的 config：

```js
theme: "theme/file-r2-lite",
```

### 2.5 部署

点击 **Deploy**，访问 `https://你的worker.你的子域.workers.dev/你的密码` 测试。

### 2.6 file-r2-lite 功能

- ✅ 选择文件 → 上传到 R2（前端直连，带进度条）
- ✅ 重名文件自动加随机后缀
- ✅ 保存到 KV（短链接管理）
- ✅ 🔍 预览按钮（点击加载原图，不判断后缀）

---

## 三、升级为 file-r2（带缩略图预览）

### 3.1 R2 自定义域名

1. Cloudflare Dashboard → 你自己的域名 → DNS
2. 添加 CNAME 记录：
   - 名称：如 `r2`（即 `r2.你的域名.com`）
   - 目标：`pub-xxxx.r2.dev`（你的 R2 公开 URL 的域名部分）
   - 代理状态：开启（橙色云朵）
3. R2 存储桶 → 设置 → 自定义域名 → 连接刚创建的域名

### 3.2 开启 Image Transformations

1. Cloudflare Dashboard → 你的域名 → 规则 → Transform Rules → **Modify Response Header**
   - 不需要，跳过
2. Cloudflare Dashboard → 你的域名 → **Speed → Optimization → Image Optimization**
3. 开启 **Image Resizing**（需要 Pro 或以上套餐）
   - 如果是免费套餐，确认 R2 的 Image Transformations 是否独立可用
4. 或者：R2 存储桶 → 设置 → Image Transformations → 开启

> **注意**：Image Transformations 需要在 R2 自定义域名所在的域名上开启。
> 免费套餐可能不支持，需要 Pro 或以上。

### 3.3 更新 R2_PUBLIC_URL

Worker 设置 → 变量 → 环境变量，将 `R2_PUBLIC_URL` 改为自定义域名：

| 变量名 | 新值 |
|---|---|
| `R2_PUBLIC_URL` | `https://r2.你的域名.com` |

### 3.4 更新 theme

编辑 `worker.js` 中的 config：

```js
theme: "theme/file-r2",
```

### 3.5 部署

点击 **Deploy**。

### 3.6 file-r2 新增功能

在 file-r2-lite 基础上：

- ✅ 图片自动展示缩略图（512px，通过 Cloudflare Image Transformations）
- ✅ 视频/音频自动嵌入播放
- ✅ 其他文件显示 🔍 预览按钮（新窗口打开）
- ❌ 非图片文件不内嵌（PDF 等）

### 3.7 验证缩略图

1. 上传一张 PNG 图片
2. 在 LocalStorage List 中应该看到缩略图
3. 如果只看到 URL 文本没有图片：
   - 检查 R2 自定义域名是否生效（浏览器直接访问 `https://r2.你的域名.com/文件名`）
   - 检查 Image Transformations 是否开启
   - 测试：访问 `https://r2.你的域名.com/cdn-cgi/image/width=512/文件名`，应返回缩略图

---

## 四、自定义域名绑定 Worker（可选）

如果想用自己的域名访问管理面板：

1. Cloudflare Dashboard → 你的域名 → DNS
2. 添加 CNAME 记录：
   - 名称：如 `file`
   - 目标：`你的worker.你的子域.workers.dev`
   - 代理状态：开启
3. Worker 设置 → 触发器 → 自定义域名 → 添加 `file.你的域名.com`

---

## 五、架构说明

```
用户浏览器
  │
  ├─ 访问 Worker → 返回 index.html（注入密码 + R2 配置）
  │
  ├─ 选择文件 → 前端生成 presigned PUT URL → 直传 R2
  │
  ├─ 保存到 KV → Worker 写入 key-value（短链 → R2 URL）
  │
  └─ 访问短链 → Worker 从 KV 查找 → 返回 value
      │
      ├─ file-r2-lite: 返回 R2 URL 文本
      │
      └─ file-r2: 返回 R2 URL → 前端用 /cdn-cgi/image/ 生成缩略图
```

### JS 文件结构

```
main.js          — 短链核心逻辑（shorturl、loadUrlList、localStorage 等）
file-r2.js       — R2 S3 签名 + 上传逻辑（两个 theme 共用）
```

### HTML 文件结构

```
theme/file-r2-lite/index.html  — 基础版，内联预览按钮逻辑
theme/file-r2/index.html       — 增强版，内联缩略图预览逻辑
```

两个 theme 都加载 `main.js` + `file-r2.js`，各自的预览逻辑内联在 `index.html` 的 `<script>` 标签中。
