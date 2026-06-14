// ====== R2 S3 Client (前端直连 R2) ======
// 提供 S3 Signature V4 签名、文件名查重、presigned URL 生成
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
    'X-Amz-SignedHeaders': 'host;x-amz-content-sha256'
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
  var canonicalHeaders = 'host:' + host + '\n' + 'x-amz-content-sha256:UNSIGNED-PAYLOAD\n';
  var signedHeaders = 'host;x-amz-content-sha256';
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

  const resp = await fetch(url, { headers: { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' } });
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
    'X-Amz-SignedHeaders': 'host;x-amz-content-sha256'
  };

  var sortedKeys = Object.keys(authParams).sort();
  var canonicalQs = sortedKeys.map(function(k) {
    return _uriEncode(k, true) + '=' + _uriEncode(authParams[k], true);
  }).join('&');

  var canonicalUri = '/' + cfg.bucketName + '/' + _uriEncode(key, true);
  var canonicalHeaders = 'host:' + host + '\n' + 'x-amz-content-sha256:UNSIGNED-PAYLOAD\n';
  var signedHeaders = 'host;x-amz-content-sha256';
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
