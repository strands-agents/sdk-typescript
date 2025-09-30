/**
 * A simple hello world function that returns a greeting message.
 *
 * @param name - The name to include in the greeting. Defaults to "World" if not provided.
 * @returns A greeting message in the format "Hello, [name]!"
 *
 * @example
 * ```typescript
 * import { hello } from '@strands-agents/sdk'
 *
 * console.log(hello()) // "Hello, World!"
 * console.log(hello('TypeScript')) // "Hello, TypeScript!"
 * ```
 */
export function hello(name: string = 'World'): string {
  return `Hello, ${name}!`
}
