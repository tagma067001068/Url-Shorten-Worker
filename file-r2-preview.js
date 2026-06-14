// ====== file-r2 预览覆盖 (缩略图 512px) ======
// 覆盖 file-r2.js 中的 buildValueItemFunc
// 不判断文件类型, 直接按缩略图加载, 失败就失败
// 依赖: r2-s3.js 中的 getR2Config

(function() {
  var IMG_MAX = 512;

  // Cloudflare Image Transformations: {origin}/cdn-cgi/image/width=512,quality=75,format=auto{pathname}
  // 用当前页面域名 (自定义域名), 不用 R2 URL 的 r2.dev 域名 (Image Transformations 不在 r2.dev 上)
  function thumbUrl(r2Url) {
    try {
      var u = new URL(r2Url);
      return window.location.origin + "/cdn-cgi/image/width=" + IMG_MAX + ",quality=75,format=auto" + u.pathname;
    } catch(e) {
      return r2Url;
    }
  }

  buildValueItemFunc = function(longUrl) {
    var wrap = document.createElement('div');
    wrap.classList.add("form-control", "rounded-top-0");

    // 直接按缩略图加载, 不判断类型
    var img = document.createElement('img');
    img.src = thumbUrl(longUrl);
    img.style.cssText = "max-width:" + IMG_MAX + "px;max-height:" + IMG_MAX + "px;border-radius:6px;cursor:pointer;display:block;";
    img.title = '点击查看原图';
    img.onerror = function() { img.remove(); }; // transform 失败移除, 只留 URL 文本
    img.onclick = function() { window.open(longUrl, '_blank'); };
    wrap.appendChild(img);

    // URL 文本
    var txt = document.createElement('small');
    txt.style.cssText = 'word-break:break-all;display:block;margin-top:4px;opacity:0.7;';
    txt.innerText = longUrl;
    wrap.appendChild(txt);

    return wrap;
  };
})();
