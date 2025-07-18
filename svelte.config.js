import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

export default {
  preprocess: vitePreprocess({
    script: ({ content, attributes }) => {
      if (attributes.lang === 'ts') {
        return {
          code: content, // vitePreprocess handles TypeScript transpilation
        };
      }
      return { code: content };
    },
  }),
  compilerOptions: {
    compatibility: {
      componentApi: 4
    }
  }
}