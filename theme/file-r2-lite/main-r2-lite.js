// ====== file-r2-lite 专用逻辑 (无自动缩略图, 内联预览) ======
// 依赖: main.js 中的 apiSrv, password_value, showResult(), addUrlToList(), loadUrlList() 等

// ====== 预览支持的文件后缀 ======
const PREVIEW_EXTS = /\.(png|jpe?g|gif|webp|bmp|svg|ico|tiff?|mp4|webm|mp3|ogg|wav|pdf)$/i;

// ====== 覆盖 buildValueItemFunc: 显示 URL + 预览按钮 + 内联预览区 ======
buildValueItemFunc = function(r2Url) {
  let container = document.createElement('div');
  container.classList.add("form-control", "rounded-top-0");

  // URL 文本
  let urlText = document.createElement('span');
  urlText.style.wordBreak = 'break-all';
  urlText.innerText = r2Url;
  container.appendChild(urlText);

  // 如果是可预览的文件后缀，显示"预览"按钮
  if (PREVIEW_EXTS.test(r2Url)) {
    let previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'btn btn-outline-info btn-sm mt-2';
    previewBtn.innerText = '🔍 预览';
    previewBtn.onclick = function() {
      togglePreview(container, urlText.innerText, previewBtn);
    };
    container.appendChild(previewBtn);

    // 内联预览区域（初始隐藏）
    let previewArea = document.createElement('div');
    previewArea.className = 'r2-inline-preview mt-2';
    previewArea.style.display = 'none';
    container.appendChild(previewArea);
  }

  return container;
}

// ====== 内联预览：切换显示/隐藏 ======
function togglePreview(container, r2Url, btn) {
  let previewArea = container.querySelector('.r2-inline-preview');
  if (!previewArea) return;

  // 如果已经有内容，切换显示
  if (previewArea.children.length > 0) {
    if (previewArea.style.display === 'none') {
      previewArea.style.display = 'block';
      btn.innerText = '🔽 收起';
    } else {
      previewArea.style.display = 'none';
      btn.innerText = '🔍 预览';
    }
    return;
  }

  // 首次点击：构建预览内容
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> 加载中...';

  if (/\.(png|jpe?g|gif|webp|bmp|svg|ico|tiff?)$/i.test(r2Url)) {
    // 图片
    let img = document.createElement('img');
    img.src = r2Url;
    img.style.cssText = 'max-width:100%;max-height:400px;border-radius:6px;cursor:pointer;';
    img.title = '点击查看原图';
    img.onload = function() {
      btn.disabled = false;
      btn.innerText = '🔽 收起';
      previewArea.style.display = 'block';
    };
    img.onerror = function() {
      btn.disabled = false;
      btn.innerText = '🔍 预览';
      previewArea.innerHTML = '<small class="text-danger">图片加载失败</small>';
      previewArea.style.display = 'block';
    };
    img.onclick = function() { window.open(r2Url, '_blank'); };
    previewArea.appendChild(img);
  } else if (/\.(mp4|webm)$/i.test(r2Url)) {
    // 视频
    let video = document.createElement('video');
    video.src = r2Url;
    video.controls = true;
    video.style.cssText = 'max-width:100%;max-height:400px;border-radius:6px;';
    video.onloadeddata = function() {
      btn.disabled = false;
      btn.innerText = '🔽 收起';
      previewArea.style.display = 'block';
    };
    video.onerror = function() {
      btn.disabled = false;
      btn.innerText = '🔍 预览';
      previewArea.innerHTML = '<small class="text-danger">视频加载失败</small>';
      previewArea.style.display = 'block';
    };
    previewArea.appendChild(video);
  } else if (/\.(mp3|ogg|wav)$/i.test(r2Url)) {
    // 音频
    let audio = document.createElement('audio');
    audio.src = r2Url;
    audio.controls = true;
    audio.style.cssText = 'width:100%;';
    audio.onloadeddata = function() {
      btn.disabled = false;
      btn.innerText = '🔽 收起';
      previewArea.style.display = 'block';
    };
    audio.onerror = function() {
      btn.disabled = false;
      btn.innerText = '🔍 预览';
      previewArea.innerHTML = '<small class="text-danger">音频加载失败</small>';
      previewArea.style.display = 'block';
    };
    previewArea.appendChild(audio);
  } else if (/\.pdf$/i.test(r2Url)) {
    // PDF
    let iframe = document.createElement('iframe');
    iframe.src = r2Url;
    iframe.style.cssText = 'width:100%;height:500px;border:none;border-radius:6px;';
    iframe.onload = function() {
      btn.disabled = false;
      btn.innerText = '🔽 收起';
      previewArea.style.display = 'block';
    };
    iframe.onerror = function() {
      btn.disabled = false;
      btn.innerText = '🔍 预览';
      previewArea.innerHTML = '<small class="text-danger">PDF 加载失败</small>';
      previewArea.style.display = 'block';
    };
    previewArea.appendChild(iframe);
  } else {
    btn.disabled = false;
    btn.innerText = '🔍 预览';
    previewArea.innerHTML = '<small class="text-muted">此文件类型不支持内联预览</small>';
    previewArea.style.display = 'block';
  }
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
      // 步骤 3: 上传完成, 填入字段
      onUploadDone(r2FinalKey, r2PublicUrl);
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

// ====== 步骤 3: 上传完成, 填入字段 (不写 KV, 等用户点"保存到 KV") ======
function onUploadDone(key, r2Url) {
  // 填入结果
  document.getElementById('longURL').value = r2Url;
  document.getElementById('keyPhrase').value = key;
  document.getElementById('addBtn').disabled = false;

  // 进度条变绿
  const progressBar = document.getElementById('progressBar');
  progressBar.classList.remove('progress-bar-animated');
  progressBar.classList.add('bg-success');
  progressBar.innerText = '上传完成 ✓';

  uploadBtn.innerText = '上传完成';
  showResult('文件已上传到 R2: ' + r2Url + '\n请点击"保存到 KV"写入 KV');
}

// ====== 保存到 KV（调用 main.js 的 shorturl, 写 KV + localStorage + 刷新列表）======
function saveToKV() {
  // longURL 和 keyPhrase 已由 onUploadDone 填入
  // 调用 main.js 的 shorturl() 完成 add 命令 (写 KV + localStorage + 刷新列表)
  shorturl();
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
