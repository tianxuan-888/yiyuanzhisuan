import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '纪元智科',
    template: '%s | 纪元智科',
  },
  description:
    '纪元智科 - 专业算力服务平台，提供算力包选购、流转交易、推广裂变等全生命周期管理服务。',
  keywords: [
    '纪元智科',
    '算力流转',
    'GPU算力',
    '算力交易',
    '云计算',
    'AI训练',
    '模型推理',
  ],
  authors: [{ name: '纪元智科' }],
  generator: '纪元智科',
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
