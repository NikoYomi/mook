import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ command }) => ({
  // 构建产物使用相对路径，配合后端注入的 <base href> 标签，
  // 同一份产物既能部署在根路径，也能部署在统一网关的 /app/mook 子路径下。
  // 开发服务器仍使用根路径，保证原有代理与热更新行为不变。
  base: command === 'build' ? './' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5866', changeOrigin: true },
      '/ws': { target: 'ws://localhost:5866', ws: true },
    },
  },
}))
