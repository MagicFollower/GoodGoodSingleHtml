import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 必须是 './'：生产包里主进程用 file:// 加载 dist/index.html，
// 绝对路径 /assets/... 会被解析到磁盘根，表现为白屏且不报错。
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false
  },
  server: { strictPort: true }
});
