/**
 * A generic, polymorphic resource registry for managing runtime resources.
 *
 * This abstract class provides methods to register, deregister, retrieve,
 * and find items based on unique identifiers. Subclasses must implement
 * methods for generating unique IDs and validating items before insertion.
 *
 * @typeParam T - The type of the items being stored.
 * @typeParam I - The type of the identifier for the items.
 */

/**
 * Thrown when an item with a specific ID cannot be found.
 * @typeParam I - The type of the item's identifier.
 */
export class ItemNotFoundError<I> extends Error {
  constructor(id: I) {
    super(`Item with id '${id}' not found`)
    this.name = 'ItemNotFoundError'
  }
}

/**
 * Thrown when attempting to add an item with an ID that already exists.
 * @typeParam I - The type of the item's identifier.
 */
export class DuplicateItemError<I> extends Error {
  constructor(id: I) {
    super(`An item with the ID '${id}' already exists.`)
    this.name = 'DuplicateItemError'
  }
}

/**
 * Thrown when an item fails a validation check.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * A generic, polymorphic registry for managing runtime resources.
 * @typeParam T - The type of the items being stored.
 * @typeParam I - The type of the identifier for the items.
 */
export abstract class Registry<T, I> {
  protected _items: Map<I, T>

  /**
   * Abstract method for generating a new, unique identifier.
   * Subclasses must provide their own implementation (e.g., UUID, auto-increment).
   * @returns A new, unique identifier.
   */
  protected abstract generateId(item: T): I

  /**
   * Abstract validation hook called before an item is added.
   * Subclasses must implement this to provide custom insertion logic.
   * @param item - The item to be validated.
   * @throws ValidationError If the item is invalid.
   */
  protected abstract validate(item: T): void

  constructor(items?: T[]) {
    this._items = new Map()
    if (items) {
      this.addAll(items)
    }
  }

  /**
   * Retrieves an item by its ID.
   * @param id - The identifier of the item to retrieve.
   * @returns The item if found, otherwise undefined.
   */
  public get(id: I): T | undefined {
    return this._items.get(id)
  }

  /**
   * Finds the first item that satisfies the provided predicate function.
   * @param predicate - A function to test each item.
   * @returns The first item that passes the predicate test, otherwise undefined.
   */
  public find(predicate: (item: T) => boolean): T | undefined {
    for (const item of this._items.values()) {
      if (predicate(item)) {
        return item
      }
    }

    return undefined
  }

  /**
   * Returns an array of all keys (identifiers) in the registry.
   * @returns An array of all keys.
   */
  public keys(): I[] {
    return Array.from(this._items.keys())
  }

  /**
   * Returns an array of all values (items) in the registry.
   * @returns An array of all values.
   */
  public values(): T[] {
    return Array.from(this._items.values())
  }

  /**
   * Returns an array of all key-value pairs in the registry.
   * @returns An array of [id, item] pairs.
   */
  public pairs(): Array<[I, T]> {
    return Array.from(this._items.entries())
  }

  /**
   * Clears all items from the registry.
   */
  public clear(): void {
    this._items.clear()
  }

  /**
   * Validates and adds a new item, assigning it a generated ID.
   * @param item - The item to add.
   * @returns The newly generated ID for the item.
   * @throws DuplicateItemError If the generated ID already exists.
   * @throws ValidationError If the item fails the validation check.
   */
  public add(item: T): I {
    this.validate(item)

    const id = this.generateId(item)
    if (this._items.has(id)) {
      throw new DuplicateItemError(id)
    }

    this._items.set(id, item)
    return id
  }

  /**
   * Adds an array of items.
   * @param items - An array of items to add.
   * @returns An array of the new IDs for the added items.
   */
  public addAll(items: T[]): I[] {
    return items.map((item) => this.add(item))
  }

  /**
   * Removes an item from the registry by its ID.
   * @param id - The ID of the item to remove.
   * @returns The removed item.
   * @throws ItemNotFoundError If no item with the given ID is found.
   */
  public remove(id: I): T {
    const item = this._items.get(id)
    if (item === undefined) {
      throw new ItemNotFoundError(id)
    }
    this._items.delete(id)
    return item
  }

  /**
   * Removes multiple items from the registry by their IDs.
   * @param ids - An array of IDs of the items to remove.
   * @returns An array of the removed items.
   */
  public removeAll(ids: I[]): T[] {
    return ids.map((id) => this.remove(id))
  }

  /**
   * Finds the first item matching the predicate, removes it, and returns it.
   * @param predicate - A function to test each item.
   * @returns The removed item if found, otherwise undefined.
   */
  public findRemove(predicate: (item: T) => boolean): T | undefined {
    for (const [id, item] of this._items.entries()) {
      if (predicate(item)) {
        this._items.delete(id)
        return item
      }
    }

    return undefined
  }
}
