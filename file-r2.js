// ====== R2 S3 Client + file-r2 上传逻辑 ======
// 提供 S3 Signature V4 签名、文件名查重、presigned URL 生成、上传到 R2
// 依赖: main.js 中的 apiSrv, password_value, showResult(), addUrlToList(), loadUrlList() 等
// 依赖 index.html 中的隐藏输入框: #r2AccountId, #r2AccessKeyId, #r2SecretAccessKey, #r2BucketName, #r2PublicUrl

// ====== 读取 R2 配置 ======
function getR2Config() {
  return {
    accountId:      document.getElementById('r2AccountId').value,
    accessKeyId:    document.getElementById('r2AccessKeyId').value,
    secretAccessKey:document.getElementById('r2SecretAccessKey').value,
    bucketName:     document.getElementById('r2BucketName').value,
    publicUrl:      document.getElementById('r2PublicUrl').value,
  };
}

// ====== S3 Signature V4 辅助函数 (Web Crypto API) ======
function _toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function _hmacSha256(key, message) {
  const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const msgData = new TextEncoder().encode(message);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', cryptoKey, msgData);
}

async function _sha256Hex(data) {
  const encoded = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return _toHex(hash);
}

function _formatDateStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(0, 8);
}

function _formatAmzDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(0, 15) + 'Z';
}

function _uriEncode(str, encodeSlash) {
  let result = encodeURIComponent(str);
  result = result.replace(/%2F/g, encodeSlash ? '%2F' : '/');
  result = result.replace(/\*/g, '%2A');
  return result;
}

// ====== 签名请求 (通用) ======
async function _signedFetch(method, path, queryParams, cfg) {
  const host = cfg.accountId + '.r2.cloudflarestorage.com';
  const now = new Date();
  const dateStamp = _formatDateStamp(now);
  const amzDate = _formatAmzDate(now);
  const credentialScope = dateStamp + '/auto/s3/aws4_request';

  // 合并所有查询参数, 按 key 字母序排序 (S3 签名要求)
  const authParams = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': cfg.accessKeyId + '/' + credentialScope,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '900',
    'X-Amz-SignedHeaders': 'host'
  };
  (queryParams || []).forEach(function(p) {
    var idx = p.indexOf('=');
    authParams[decodeURIComponent(p.substring(0, idx))] = decodeURIComponent(p.substring(idx + 1));
  });

  var sortedKeys = Object.keys(authParams).sort();
  var canonicalQsParts = sortedKeys.map(function(k) {
    return _uriEncode(k, true) + '=' + _uriEncode(authParams[k], true);
  });
  var canonicalQs = canonicalQsParts.join('&');

  var canonicalUri = '/' + cfg.bucketName + path;
  var canonicalHeaders = 'host:' + host + '\n';
  var signedHeaders = 'host';
  var canonicalRequest = method + '\n' + canonicalUri + '\n' + canonicalQs + '\n' + canonicalHeaders + '\n' + signedHeaders + '\nUNSIGNED-PAYLOAD';

  var requestHash = await _sha256Hex(canonicalRequest);
  var stringToSign = 'AWS4-HMAC-SHA256\n' + amzDate + '\n' + credentialScope + '\n' + requestHash;

  var kDate = await _hmacSha256('AWS4' + cfg.secretAccessKey, dateStamp);
  var kRegion = await _hmacSha256(kDate, 'auto');
  var kService = await _hmacSha256(kRegion, 's3');
  var kSigning = await _hmacSha256(kService, 'aws4_request');
  var signature = _toHex(await _hmacSha256(kSigning, stringToSign));

  var url = 'https://' + host + canonicalUri + '?' + canonicalQs + '&X-Amz-Signature=' + signature;
  return { url: url, host: host };
}

// ====== 检查 R2 中是否存在某个 key ======
async function r2KeyExists(key) {
  const cfg = getR2Config();
  const { url } = await _signedFetch('GET', '', [
    'list-type=2',
    'prefix=' + _uriEncode(key, false),
    'max-keys=100'
  ], cfg);

  const resp = await fetch(url);
  const xml = await resp.text();

  // 解析 XML 查找精确匹配的 key
  const keys = [];
  const re = /<Key>(.*?)<\/Key>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    keys.push(m[1]);
  }
  return keys.indexOf(key) !== -1;
}

// ====== 生成 presigned PUT URL (带过期时间) ======
async function r2GeneratePresignedPutUrl(key, expiresIn) {
  const cfg = getR2Config();
  expiresIn = expiresIn || 900;
  const host = cfg.accountId + '.r2.cloudflarestorage.com';
  const now = new Date();
  const dateStamp = _formatDateStamp(now);
  const amzDate = _formatAmzDate(now);
  const credentialScope = dateStamp + '/auto/s3/aws4_request';

  // 按 key 字母序排序 (S3 签名要求)
  var authParams = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': cfg.accessKeyId + '/' + credentialScope,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host'
  };

  var sortedKeys = Object.keys(authParams).sort();
  var canonicalQs = sortedKeys.map(function(k) {
    return _uriEncode(k, true) + '=' + _uriEncode(authParams[k], true);
  }).join('&');

  var canonicalUri = '/' + cfg.bucketName + '/' + _uriEncode(key, true);
  var canonicalHeaders = 'host:' + host + '\n';
  var signedHeaders = 'host';
  var canonicalRequest = 'PUT\n' + canonicalUri + '\n' + canonicalQs + '\n' + canonicalHeaders + '\n' + signedHeaders + '\nUNSIGNED-PAYLOAD';

  var requestHash = await _sha256Hex(canonicalRequest);
  var stringToSign = 'AWS4-HMAC-SHA256\n' + amzDate + '\n' + credentialScope + '\n' + requestHash;

  var kDate = await _hmacSha256('AWS4' + cfg.secretAccessKey, dateStamp);
  var kRegion = await _hmacSha256(kDate, 'auto');
  var kService = await _hmacSha256(kRegion, 's3');
  var kSigning = await _hmacSha256(kService, 'aws4_request');
  var signature = _toHex(await _hmacSha256(kSigning, stringToSign));

  return 'https://' + host + canonicalUri + '?' + canonicalQs + '&X-Amz-Signature=' + signature;
}

// ====== 删除 R2 对象 ======
async function r2DeleteObject(key) {
  const cfg = getR2Config();
  const { url } = await _signedFetch('DELETE', '/' + _uriEncode(key, true), [], cfg);
  const resp = await fetch(url, { method: 'DELETE' });
  return resp.ok;
}

// ====== 随机字符串 ======
function r2RandomString(len) {
  len = len || 6;
  var chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
  var result = '';
  for (var i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ====== 生成不重名的文件名 ======
// 如果 R2 中已存在同名文件, 在扩展名前加 _随机串
// 最多重试 5 次
async function r2ResolveFilename(filename) {
  var finalKey = filename;
  var exists = await r2KeyExists(finalKey);

  if (exists) {
    var dotIndex = filename.lastIndexOf('.');
    var namePart = dotIndex > 0 ? filename.substring(0, dotIndex) : filename;
    var extPart = dotIndex > 0 ? filename.substring(dotIndex) : '';

    for (var attempt = 0; attempt < 5; attempt++) {
      finalKey = namePart + '_' + r2RandomString(6) + extPart;
      var stillExists = await r2KeyExists(finalKey);
      if (!stillExists) {
        return { key: finalKey, renamed: true };
      }
    }
    return { key: null, renamed: false, error: '无法生成唯一文件名, 请重试' };
  }

  return { key: finalKey, renamed: false };
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
