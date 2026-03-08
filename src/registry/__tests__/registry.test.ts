import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Registry, ItemNotFoundError, DuplicateItemError, ValidationError } from '../registry.js'

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
  it('ItemNotFoundError has the correct name and message', () => {
    const error = new ItemNotFoundError(123)
    expect(error.name).toBe('ItemNotFoundError')
    expect(error.message).toBe("Item with id '123' not found")
  })

  it('DuplicateItemError has the correct name and message', () => {
    const error = new DuplicateItemError('abc')
    expect(error.name).toBe('DuplicateItemError')
    expect(error.message).toBe("An item with the ID 'abc' already exists.")
  })

  it('ValidationError has the correct name and message', () => {
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

  it('registers an item and returns a new ID', () => {
    const id = registry.add('test-item')
    expect(id).toBe(1)
    expect(registry.get(1)).toBe('test-item')
  })

  it('throws DuplicateItemError when registering with an existing ID', () => {
    // @ts-expect-error - Spying on protected 'generateId' to test duplicate handling.
    const generateIdSpy = vi.spyOn(registry, 'generateId').mockReturnValue(1)
    registry.add('test-item')
    expect(() => registry.add('another-item')).toThrow(DuplicateItemError)
    generateIdSpy.mockRestore()
  })

  it('deregisters an item and returns it', () => {
    const id = registry.add('test-item')
    const deregisteredItem = registry.remove(id)
    expect(deregisteredItem).toBe('test-item')
    expect(registry.get(id)).toBeUndefined()
  })

  it('throws ItemNotFoundError when deregistering a non-existent item', () => {
    expect(() => registry.remove(999)).toThrow(ItemNotFoundError)
  })

  it('gets an item by its ID', () => {
    const id = registry.add('test-item')
    const foundItem = registry.get(id)
    expect(foundItem).toBe('test-item')
  })

  it('returns undefined when getting a non-existent item', () => {
    const foundItem = registry.get(999)
    expect(foundItem).toBeUndefined()
  })

  it('finds an item using a predicate', () => {
    registry.add('item-a')
    registry.add('item-b')
    const foundItem = registry.find((item) => item.includes('b'))
    expect(foundItem).toBe('item-b')
  })

  it('returns undefined when no item matches the predicate', () => {
    registry.add('item-a')
    const foundItem = registry.find((item) => item.includes('c'))
    expect(foundItem).toBeUndefined()
  })

  it('returns all keys', () => {
    registry.add('item-1')
    registry.add('item-2')
    expect(registry.keys()).toEqual([1, 2])
  })

  it('returns all values', () => {
    registry.add('item-1')
    registry.add('item-2')
    expect(registry.values()).toEqual(['item-1', 'item-2'])
  })

  it('returns all key-value pairs', () => {
    registry.add('item-1')
    registry.add('item-2')
    expect(registry.pairs()).toEqual([
      [1, 'item-1'],
      [2, 'item-2'],
    ])
  })

  it('clears all items from the registry', () => {
    registry.add('item-1')
    registry.clear()
    expect(registry.keys()).toEqual([])
    expect(registry.values()).toEqual([])
  })

  it('registers multiple items', () => {
    const ids = registry.addAll(['item-a', 'item-b'])
    expect(ids).toEqual([1, 2])
    expect(registry.values()).toEqual(['item-a', 'item-b'])
  })

  it('deregisters multiple items', () => {
    const ids = registry.addAll(['item-a', 'item-b', 'item-c'])
    const deregisteredItems = registry.removeAll([ids[0]!, ids[2]!])
    expect(deregisteredItems).toEqual(['item-a', 'item-c'])
    expect(registry.values()).toEqual(['item-b'])
  })

  it('finds and deregisters an item', () => {
    registry.add('item-a')
    registry.add('item-b')
    const deregisteredItem = registry.findRemove((item) => item.includes('a'))
    expect(deregisteredItem).toBe('item-a')
    expect(registry.values()).toEqual(['item-b'])
  })

  it('returns undefined from findRemove if no item matches', () => {
    const removedItem = registry.findRemove((item) => item.includes('c'))
    expect(removedItem).toBeUndefined()
  })

  it('calls the validate method on register', () => {
    // @ts-expect-error - Spying on protected 'validate' to confirm it is called.
    const validateSpy = vi.spyOn(registry, 'validate')
    registry.add('a-valid-item')
    expect(validateSpy).toHaveBeenCalledWith('a-valid-item')
    validateSpy.mockRestore()
  })

  it('throws a validation error for an invalid item', () => {
    expect(() => registry.add('')).toThrow(ValidationError)
  })
})
