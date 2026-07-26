import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // ソースのテストだけを対象にする。ビルド済みの成果物にテストが混ざっていた場合に
    // 同じテストが二重に走ったり、消したはずのテストが古い成果物から生き残って
    // 通り続けたりするのを防ぐ。
    include: ['src/**/*.test.ts'],
  },
})
