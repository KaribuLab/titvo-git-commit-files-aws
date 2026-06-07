import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  testEnvironment: 'node',
  transform: {
    // Compilamos los tests a CommonJS para que los globals de Jest (jest, describe,
    // expect, etc.) esten disponibles sin necesidad de importarlos en cada archivo.
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs' } }],
  },
  moduleNameMapper: {
    '^@lambda/(.*)$': '<rootDir>/src/$1',
  },
};

export default config;
