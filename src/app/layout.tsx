import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '艺元智算',
    template: '%s | 艺元智算',
  },
  description:
    '艺元智算 - 专业Token服务平台，提供Token存储包选购、流转交易、推广裂变等全生命周期管理服务。',
  keywords: [
    '艺元智算',
    '算力流转',
    'GPU算力',
    '算力交易',
    '云计算',
    'AI训练',
    '模型推理',
  ],
  authors: [{ name: '艺元智算' }],
  generator: '艺元智算',
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
