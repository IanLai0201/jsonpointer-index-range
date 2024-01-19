import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import dts from 'rollup-plugin-dts';
import esbuild from 'rollup-plugin-esbuild';

const input = 'src/index.ts';

export default [
  {
    input,
    plugins: [resolve(), commonjs(), esbuild()],
    output: [
      {
        file: `dist/index.js`,
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: `dist/index.mjs`,
        format: 'esm',
        sourcemap: true,
      },
    ],
    external: ['lodash-es'],
  },
  {
    input,
    plugins: [dts()],
    output: [
      {
        file: `dist/index.d.mts`,
        format: 'esm',
      },
      {
        file: `dist/index.d.ts`,
        format: 'esm',
      },
      {
        file: `dist/index.d.cts`,
        format: 'cjs',
      },
    ],
    external: [],
  },
];
