/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['*.dev.coze.site'],
  // 禁用 Turbopack，使用 Webpack 构建（Vercel 兼容性更好）
  turbopack: false,
  images: {
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
