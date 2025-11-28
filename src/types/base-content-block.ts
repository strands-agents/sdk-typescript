/**
 * Base class for all content blocks.
 * @internal
 * TODO: Make this public in a future release to allow custom content blocks.
 */
export abstract class BaseContentBlock {
  abstract readonly type: string
}
