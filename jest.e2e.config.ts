import type { Config } from 'jest';
import baseConfig from './jest.config.ts';

// E2E (*.e2e-spec.ts) e integração (*.int-spec.ts) ficam juntos porque os dois
// precisam de Docker ou de serviços de pé; rodam em série (--runInBand).
const config: Config = {
  ...baseConfig,
  testRegex: '.*\.(e2e|int)-spec\.ts$',
  testTimeout: 60_000,
};

export default config;
