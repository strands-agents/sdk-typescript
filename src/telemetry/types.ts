/**
 * Type definitions for OpenTelemetry integration.
 *
 * These types are used internally by the telemetry module and exported
 * for consumers who need to specify custom trace attributes.
 */

/**
 * Attribute value types supported by OpenTelemetry spans.
 */
export type AttributeValue = string | number | boolean | string[]
