/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['*.dev.coze.site'],
  // Turbopack 在 Next.js 16 中需使用对象格式，此处显式禁用
  turbopack: {},
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lf-coze-web-cdn.coze.cn',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'coze-coding-project.tos.coze.site',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'code.coze.cn',
        pathname: '/**',
      },
    ],
  },
};

module.exports = nextConfig;

// Cloudflare Pages 本地开发集成
try {
  const { initOpenNextCloudflareForDev } = require("@opennextjs/cloudflare");
  initOpenNextCloudflareForDev();
} catch (e) {
  // 非 Cloudflare 开发环境忽略
}
