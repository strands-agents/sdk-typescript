/**
 * Ensures a value is defined, throwing an error if it's null or undefined.
 *
 * @param value - The value to check
 * @param fieldName - Name of the field for error reporting
 * @returns The value if defined
 * @throws Error if value is null or undefined
 */
export function ensureDefined<T>(value: T | null | undefined, fieldName: string): T {
  if (value == null) {
    throw new Error(`Expected ${fieldName} to be defined, but got ${value}`)
  }
  return value
}

/**
 * Validates that an identifier does not contain path separators.
 *
 * @param id - The identifier to validate
 * @returns The validated identifier
 * @throws Error if identifier contains path separators
 */
export function validateIdentifier(id: string): string {
  if (id.includes('/') || id.includes('\\')) {
    throw new Error(`Identifier '${id}' cannot contain path separators`)
  }
  return id
}
