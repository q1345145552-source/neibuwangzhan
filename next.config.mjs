/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: process.cwd(),
  },
  // pdfkit 依赖 __dirname 定位内置 AFM 字体文件，被打包进 server chunk 后路径会变成
  // /ROOT/...，导致生成 PDF 时报 Helvetica.afm 找不到。作为外部包让其走真实 node_modules 路径。
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
