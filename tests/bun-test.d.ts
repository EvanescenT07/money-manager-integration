declare module "bun:test" {
  export interface Matchers<T> {
    toBe(expected: T): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toBeNull(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toContain(expected: unknown): void;
    toHaveLength(expected: number): void;
    toMatch(expected: RegExp | string): void;
    toThrow(expected?: unknown): void;
    toBeInstanceOf(expected: unknown): void;
    not: Matchers<T>;
  }

  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function expect<T>(actual: T): Matchers<T>;
  export function setSystemTime(date?: Date | number): void;
}
