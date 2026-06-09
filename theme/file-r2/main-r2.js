// ====== file-r2 专用逻辑 ======
// 依赖: main.js 中的 apiSrv, password_value, showResult(), addUrlToList(), loadUrlList() 等

// ====== 图片预览配置 ======
const IMG_RESIZE_BASE  = "https://r2.lvedong.eu.org";  // Transformations 域名（留空则跳过缩略图，原图 + CSS 缩放）
const IMG_PREVIEW_WIDTH = 200;                          // 缩略图宽度 (px)
const IMG_EXTS = /\.(png|jpe?g|gif|webp|bmp|svg|ico|tiff?)$/i;

// 从 R2 URL 构建 Transformations 缩略图 URL
function buildThumbUrl(r2Url) {
  if (!IMG_RESIZE_BASE) return r2Url;  // 未配置域名时回退原图
  const url = new URL(r2Url);
  return IMG_RESIZE_BASE + "/cdn-cgi/image/width=" + IMG_PREVIEW_WIDTH +
         ",quality=75,format=auto" + url.pathname;
}

// 插入预览图片（通用：自动预览 + 按钮触发共用）
function insertPreviewImg(targetDiv, r2Url) {
  // 避免重复插入
  if (targetDiv.querySelector('img.r2-preview')) return;

  const img = document.createElement('img');
  img.src = buildThumbUrl(r2Url);
  img.className = 'r2-preview mt-2';
  img.style.cssText = 'max-width:' + IMG_PREVIEW_WIDTH + 'px;max-height:200px;border-radius:6px;cursor:pointer;';
  img.loading = 'lazy';
  img.title = '点击查看原图';
  img.onclick = function() { window.open(r2Url, '_blank'); };
  targetDiv.appendChild(img);
}

// 覆盖 buildValueItemFunc：图片后缀自动预览，其它后缀显示"预览"按钮
buildValueItemFunc = function(r2Url) {
  let container = document.createElement('div');
  container.classList.add("form-control", "rounded-top-0");

  // URL 文本
  let urlText = document.createElement('span');
  urlText.style.wordBreak = 'break-all';
  urlText.innerText = r2Url;
  container.appendChild(urlText);

  // 判断是否图片后缀
  if (IMG_EXTS.test(r2Url)) {
    // 图片后缀：自动插入缩略图预览
    insertPreviewImg(container, r2Url);
  } else {
    // 非图片后缀：显示"预览"按钮（主动触发，兜底后缀判断不全）
    let previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'btn btn-outline-info btn-sm mt-2';
    previewBtn.innerText = '🔍 预览';
    previewBtn.onclick = function() {
      insertPreviewImg(container, r2Url);
      previewBtn.style.display = 'none';  // 预览后隐藏按钮
    };
    container.appendChild(previewBtn);
  }

  return container;
}

// 状态变量
let r2UploadUrl = null;   // presigned PUT URL
let r2PublicUrl = null;   // R2 公开 URL
let r2FinalKey  = null;   // 最终文件名 key

// ====== 文件选择事件 ======
const inputFile = document.getElementById('input_file');
const uploadBtn = document.getElementById('uploadBtn');

inputFile.addEventListener('change', function() {
  if (this.files.length > 0) {
    uploadBtn.disabled = false;
    uploadBtn.innerText = '上传到 R2: ' + this.files[0].name;
    // 重置状态
    document.getElementById('longURL').value = '';
    document.getElementById('keyPhrase').value = '';
    document.getElementById('addBtn').disabled = true;
  } else {
    uploadBtn.disabled = true;
    uploadBtn.innerText = '上传到 R2';
  }
});

// ====== 步骤 1: 请求 presigned URL ======
function uploadToR2() {
  const file = inputFile.files[0];
  if (!file) {
    alert('请先选择文件');
    return;
  }

  uploadBtn.disabled = true;
  uploadBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> 获取上传链接...';

  fetch(apiSrv, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cmd: 'presign',
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      password: password_value
    })
  })
  .then(function(response) { return response.json(); })
  .then(function(json) {
    if (json.status == 200) {
      r2UploadUrl = json.uploadUrl;
      r2PublicUrl = json.r2Url;
      r2FinalKey  = json.key;

      // 步骤 2: 直传 R2
      uploadFileToR2(file, r2UploadUrl, file.type || 'application/octet-stream');
    } else {
      resetUploadBtn();
      showResult(json.error || '获取上传链接失败');
    }
  })
  .catch(function(err) {
    resetUploadBtn();
    showResult('请求 presign 失败: ' + err.message);
  });
}

// ====== 步骤 2: 直传 R2（带进度条）======
function uploadFileToR2(file, uploadUrl, contentType) {
  uploadBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> 上传中...';

  // 显示进度条
  const progressWrap = document.getElementById('progressWrap');
  const progressBar  = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  progressWrap.style.display = 'block';
  progressBar.style.width = '0%';
  progressBar.innerText = '0%';
  progressText.innerText = '';

  const xhr = new XMLHttpRequest();
  xhr.open('PUT', uploadUrl, true);
  // 不设 Content-Type, 避免触发 CORS 预检 (Content-Type 不在签名中, R2 不会校验)

  // 上传进度
  xhr.upload.addEventListener('progress', function(e) {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      progressBar.style.width = pct + '%';
      progressBar.innerText = pct + '%';
      progressText.innerText = formatBytes(e.loaded) + ' / ' + formatBytes(e.total);
    }
  });

  // 上传完成
  xhr.addEventListener('load', function() {
    if (xhr.status >= 200 && xhr.status < 300) {
      // 步骤 3: confirm 存 KV
      confirmUpload(r2FinalKey, r2PublicUrl);
    } else {
      resetUploadBtn();
      progressWrap.style.display = 'none';
      showResult('R2 上传失败, HTTP ' + xhr.status);
    }
  });

  xhr.addEventListener('error', function() {
    resetUploadBtn();
    progressWrap.style.display = 'none';
    showResult('R2 上传网络错误');
  });

  xhr.send(file);
}

// ====== 步骤 3: confirm 存 KV ======
function confirmUpload(key, r2Url) {
  fetch(apiSrv, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cmd: 'confirm',
      key: key,
      r2Url: r2Url,
      password: password_value
    })
  })
  .then(function(response) { return response.json(); })
  .then(function(json) {
    if (json.status == 200) {
      // 填入结果
      document.getElementById('longURL').value = r2Url;
      document.getElementById('keyPhrase').value = key;
      document.getElementById('addBtn').disabled = false;

      // 保存到 localStorage
      localStorage.setItem(key, r2Url);
      loadUrlList();

      // 进度条变绿
      const progressBar = document.getElementById('progressBar');
      progressBar.classList.remove('progress-bar-animated');
      progressBar.classList.add('bg-success');
      progressBar.innerText = '上传完成 ✓';

      uploadBtn.innerText = '上传完成';
      showResult('文件已上传: ' + r2Url);
    } else {
      resetUploadBtn();
      document.getElementById('progressWrap').style.display = 'none';
      showResult('confirm 失败: ' + (json.error || '未知错误'));
    }
  })
  .catch(function(err) {
    resetUploadBtn();
    document.getElementById('progressWrap').style.display = 'none';
    showResult('confirm 请求失败: ' + err.message);
  });
}

// ====== 保存到 KV（复用 main.js 的 shorturl 逻辑，但用 confirm 已完成，这里只是显示）======
function saveToKV() {
  // KV 已经在 confirm 步骤中写入了
  // 这个按钮只是显示短链地址
  const key = document.getElementById('keyPhrase').value;
  if (key) {
    const shortUrl = window.location.protocol + '//' + window.location.host + '/' + key;
    showResult(shortUrl);
  }
}

// ====== 工具函数 ======
function resetUploadBtn() {
  uploadBtn.disabled = false;
  uploadBtn.innerText = '上传到 R2';
}

function showResult(msg) {
  document.getElementById('result').innerHTML = msg;
  var modal = new bootstrap.Modal(document.getElementById('resultModal'));
  modal.show();
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  var k = 1024;
  var sizes = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}
