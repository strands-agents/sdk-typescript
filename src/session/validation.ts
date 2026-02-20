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
