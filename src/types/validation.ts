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
 * Validates that an identifier contains only allowed characters.
 * Allowed characters: lowercase letters (a-z), numbers (0-9), hyphens (-), and underscores (_)
 *
 * @param id - The identifier to validate
 * @returns The validated identifier
 * @throws Error if identifier contains invalid characters
 */
export function validateIdentifier(id: string): string {
  const validPattern = /^[a-z0-9_-]+$/
  if (!validPattern.test(id)) {
    throw new Error(`Identifier '${id}' can only contain lowercase letters, numbers, hyphens, and underscores`)
  }
  return id
}
