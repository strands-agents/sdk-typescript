import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
    resolve: {
        alias: {
            '@strands-agents/sdk/openai': path.resolve(__dirname, '../../src/models/openai.ts'),
            '@strands-agents/sdk/anthropic': path.resolve(__dirname, '../../src/models/anthropic.ts'),
            '@strands-agents/sdk': path.resolve(__dirname, '../../src/index.ts'),
        },
        dedupe: ['zod'],
    },
    define: {
        'process.env': {},
    },
})
