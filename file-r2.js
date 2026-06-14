// ====== file-r2 专用逻辑 (上传到 R2 + 保存到 KV) ======
// 依赖: main.js 中的 apiSrv, password_value, showResult(), addUrlToList(), loadUrlList() 等
// 依赖: r2-s3.js 中的 r2ResolveFilename, r2GeneratePresignedPutUrl, getR2Config

// ====== 覆盖 buildValueItemFunc: URL 文本 + 预览按钮 (点击加载原图) ======
buildValueItemFunc = function(r2Url) {
  var container = document.createElement('div');
  container.classList.add("form-control", "rounded-top-0");

  var urlText = document.createElement('span');
  urlText.style.wordBreak = 'break-all';
  urlText.innerText = r2Url;
  container.appendChild(urlText);

  var previewArea = document.createElement('div');
  previewArea.style.display = 'none';
  container.appendChild(previewArea);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-outline-info btn-sm mt-2';
  btn.innerText = '🔍 预览';
  btn.onclick = function() {
    if (previewArea.style.display !== 'none' && previewArea.children.length > 0) {
      previewArea.style.display = 'none';
      previewArea.innerHTML = '';
      btn.innerText = '🔍 预览';
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span>';
    var img = document.createElement('img');
    img.src = r2Url;
    img.style.cssText = 'max-width:100%;max-height:400px;border-radius:6px;cursor:pointer;margin-top:4px;';
    img.title = '点击查看原图';
    img.onload = function() {
      btn.disabled = false;
      btn.innerText = '🔽 收起';
      previewArea.style.display = 'block';
    };
    img.onerror = function() {
      btn.disabled = false;
      btn.innerText = '🔍 预览';
      previewArea.innerHTML = '<small class="text-danger">加载失败</small>';
      previewArea.style.display = 'block';
    };
    img.onclick = function() { window.open(r2Url, '_blank'); };
    previewArea.innerHTML = '';
    previewArea.appendChild(img);
    previewArea.style.display = 'block';
  };
  container.appendChild(btn);

  return container;
}

// ====== 状态变量 ======
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

// ====== 步骤 1: 查重 + 生成 presigned URL (前端直连 R2) ======
async function uploadToR2() {
  const file = inputFile.files[0];
  if (!file) {
    alert('请先选择文件');
    return;
  }

  uploadBtn.disabled = true;
  uploadBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> 检查文件名...';

  try {
    // 1. 检查 R2 中是否重名, 重名则自动生成新文件名
    var result = await r2ResolveFilename(file.name);
    if (!result.key) {
      resetUploadBtn();
      showResult(result.error || '文件名解析失败');
      return;
    }

    r2FinalKey = result.key;
    var cfg = getR2Config();
    r2PublicUrl = cfg.publicUrl + '/' + encodeURIComponent(r2FinalKey);

    if (result.renamed) {
      uploadBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> 重名, 已改为 ' + r2FinalKey;
      await new Promise(function(r) { setTimeout(r, 800); });
    }

    // 2. 前端生成 presigned PUT URL
    uploadBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> 生成上传链接...';
    r2UploadUrl = await r2GeneratePresignedPutUrl(r2FinalKey);

    // 3. 直传 R2
    uploadFileToR2(file, r2UploadUrl);

  } catch (err) {
    resetUploadBtn();
    showResult('上传准备失败: ' + err.message);
  }
}

// ====== 步骤 2: 直传 R2（带进度条）======
function uploadFileToR2(file, uploadUrl) {
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
