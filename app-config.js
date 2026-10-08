// 部署前只需修改 apiBaseUrl。留空时使用当前网站的 /api/generate；请勿在此文件放置任何 API Key。
window.IP_EMOJI_CONFIG = Object.freeze({
  mode: 'proxy',
  apiBaseUrl: '',
  requestTimeoutMs: 120000,
  maxUploadBytes: 4 * 1024 * 1024,
  maxUploadDimension: 1536,
  enableLocalDirectMode: false,
});
