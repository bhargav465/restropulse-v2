/**
 * Vitest 4's assertion interfaces live in @vitest/expect, while
 * @testing-library/jest-dom (6.x) only augments the legacy `Assertion`
 * interface on the `vitest` module — bridge the two for type-checking.
 */
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module '@vitest/expect' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends TestingLibraryMatchers<any, T> {}
}
