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
  protected _items: Map<I, T> = new Map()

  /**
   * Abstract method for generating a new, unique identifier.
   * Subclasses must provide their own implementation (e.g., UUID, auto-increment).
   * @returns A new, unique identifier.
   */
  protected abstract generateId(): I

  /**
   * Abstract validation hook called before an item is added.
   * Subclasses must implement this to provide custom insertion logic.
   * @param item - The item to be validated.
   * @throws ValidationError If the item is invalid.
   */
  protected abstract validate(item: T): void

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
   * Validates and registers a new item, assigning it a generated ID.
   * @param item - The item to register.
   * @returns The newly generated ID for the item.
   * @throws DuplicateItemError If the generated ID already exists.
   * @throws ValidationError If the item fails the validation check.
   */
  public register(item: T): I {
    this.validate(item)

    const id = this.generateId()
    if (this._items.has(id)) {
      throw new DuplicateItemError(id)
    }

    this._items.set(id, item)
    return id
  }

  /**
   * Registers an array of items.
   * @param items - An array of items to register.
   * @returns An array of the new IDs for the registered items.
   */
  public registerAll(items: T[]): I[] {
    return items.map((item) => this.register(item))
  }

  /**
   * Removes an item from the registry by its ID.
   * @param id - The ID of the item to remove.
   * @returns The removed item.
   * @throws ItemNotFoundError If no item with the given ID is found.
   */
  public deregister(id: I): T {
    const item = this._items.get(id)
    if (item === undefined) {
      throw new ItemNotFoundError(id)
    }
    this._items.delete(id)
    return item
  }

  /**
   * Finds the first item matching the predicate, removes it, and returns it.
   * @param predicate - A function to test each item.
   * @returns The removed item if found, otherwise undefined.
   */
  public findDeregister(predicate: (item: T) => boolean): T | undefined {
    for (const [id, item] of this._items.entries()) {
      if (predicate(item)) {
        this._items.delete(id)
        return item
      }
    }

    return undefined
  }

  /**
   * Removes multiple items from the registry by their IDs.
   * @param ids - An array of IDs of the items to remove.
   * @returns An array of the removed items.
   */
  public deregisterAll(ids: I[]): T[] {
    return ids.map((id) => this.deregister(id))
  }
}

// Unit tests
if (import.meta.vitest) {
  const { describe, it, expect, beforeEach, vi } = import.meta.vitest

  // A concrete implementation of the abstract Registry for testing purposes
  class TestRegistry extends Registry<string, number> {
    private nextId = 1

    protected generateId(): number {
      return this.nextId++
    }

    protected validate(item: string): void {
      if (item.length === 0) {
        throw new ValidationError('Item cannot be an empty string.')
      }
    }
  }

  describe('Error Classes', () => {
    it('ItemNotFoundError should have the correct name and message', () => {
      const error = new ItemNotFoundError(123)
      expect(error.name).toBe('ItemNotFoundError')
      expect(error.message).toBe("Item with id '123' not found")
    })

    it('DuplicateItemError should have the correct name and message', () => {
      const error = new DuplicateItemError('abc')
      expect(error.name).toBe('DuplicateItemError')
      expect(error.message).toBe("An item with the ID 'abc' already exists.")
    })

    it('ValidationError should have the correct name and message', () => {
      const error = new ValidationError('Invalid item')
      expect(error.name).toBe('ValidationError')
      expect(error.message).toBe('Invalid item')
    })
  })

  describe('Registry', () => {
    let registry: TestRegistry

    beforeEach(() => {
      registry = new TestRegistry()
    })

    it('should register an item and return a new ID', () => {
      const id = registry.register('test-item')
      expect(id).toBe(1)
      expect(registry.get(1)).toBe('test-item')
    })

    it('should throw DuplicateItemError when registering with an existing ID', () => {
      // @ts-expect-error - Spying on protected 'generateId' to test duplicate handling.
      const generateIdSpy = vi.spyOn(registry, 'generateId').mockReturnValue(1)
      registry.register('test-item') // This will register with ID 1.
      expect(() => registry.register('another-item')).toThrow(DuplicateItemError)
      generateIdSpy.mockRestore()
    })

    it('should deregister an item and return it', () => {
      const id = registry.register('test-item')
      const deregisteredItem = registry.deregister(id)
      expect(deregisteredItem).toBe('test-item')
      expect(registry.get(id)).toBeUndefined()
    })

    it('should throw ItemNotFoundError when deregistering a non-existent item', () => {
      expect(() => registry.deregister(999)).toThrow(ItemNotFoundError)
    })

    it('should get an item by its ID', () => {
      const id = registry.register('test-item')
      const foundItem = registry.get(id)
      expect(foundItem).toBe('test-item')
    })

    it('should return undefined when getting a non-existent item', () => {
      const foundItem = registry.get(999)
      expect(foundItem).toBeUndefined()
    })

    it('should find an item using a predicate', () => {
      registry.register('item-a')
      registry.register('item-b')
      const foundItem = registry.find((item) => item.includes('b'))
      expect(foundItem).toBe('item-b')
    })

    it('should return undefined when no item matches the predicate', () => {
      registry.register('item-a')
      const foundItem = registry.find((item) => item.includes('c'))
      expect(foundItem).toBeUndefined()
    })

    it('should return all keys', () => {
      registry.register('item-1')
      registry.register('item-2')
      expect(registry.keys()).toEqual([1, 2])
    })

    it('should return all values', () => {
      registry.register('item-1')
      registry.register('item-2')
      expect(registry.values()).toEqual(['item-1', 'item-2'])
    })

    it('should return all key-value pairs', () => {
      registry.register('item-1')
      registry.register('item-2')
      expect(registry.pairs()).toEqual([
        [1, 'item-1'],
        [2, 'item-2'],
      ])
    })

    it('should clear all items from the registry', () => {
      registry.register('item-1')
      registry.clear()
      expect(registry.keys()).toEqual([])
      expect(registry.values()).toEqual([])
    })

    it('should register multiple items', () => {
      const ids = registry.registerAll(['item-a', 'item-b'])
      expect(ids).toEqual([1, 2])
      expect(registry.values()).toEqual(['item-a', 'item-b'])
    })

    it('should deregister multiple items', () => {
      const ids = registry.registerAll(['item-a', 'item-b', 'item-c'])
      const deregisteredItems = registry.deregisterAll([ids[0]!, ids[2]!])
      expect(deregisteredItems).toEqual(['item-a', 'item-c'])
      expect(registry.values()).toEqual(['item-b'])
    })

    it('should find and deregister an item', () => {
      registry.register('item-a')
      registry.register('item-b')
      const deregisteredItem = registry.findDeregister((item) => item.includes('a'))
      expect(deregisteredItem).toBe('item-a')
      expect(registry.values()).toEqual(['item-b'])
    })

    it('should return undefined from findDeregister if no item matches', () => {
      registry.register('item-a')
      const deregisteredItem = registry.findDeregister((item) => item.includes('c'))
      expect(deregisteredItem).toBeUndefined()
      expect(registry.values()).toEqual(['item-a'])
    })

    it('should call the validate method on register', () => {
      // @ts-expect-error - Spying on protected 'validate' to confirm it is called.
      const validateSpy = vi.spyOn(registry, 'validate')
      registry.register('a-valid-item')
      expect(validateSpy).toHaveBeenCalledWith('a-valid-item')
      validateSpy.mockRestore()
    })

    it('should throw a validation error for an invalid item', () => {
      expect(() => registry.register('')).toThrow(ValidationError)
    })
  })
}
