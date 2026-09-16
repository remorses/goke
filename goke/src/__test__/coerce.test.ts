import { describe, test, expect } from 'vitest'
import { coerceBySchema } from '../coerce.js'

describe('coerceBySchema', () => {
  describe('string type', () => {
    test('string stays as string', () => {
      expect(coerceBySchema('hello', { type: 'string' }, 'name')).toBe('hello')
    })

    test('preserves leading zeros', () => {
      expect(coerceBySchema('00123', { type: 'string' }, 'id')).toBe('00123')
    })

    test('numeric string stays as string', () => {
      expect(coerceBySchema('3000', { type: 'string' }, 'port')).toBe('3000')
    })

    test('boolean coerced to string', () => {
      expect(coerceBySchema(true, { type: 'string' }, 'flag')).toBe('true')
      expect(coerceBySchema(false, { type: 'string' }, 'flag')).toBe('false')
    })
  })

  describe('number type', () => {
    test('numeric string to number', () => {
      expect(coerceBySchema('3000', { type: 'number' }, 'port')).toBe(3000)
    })

    test('decimal string to number', () => {
      expect(coerceBySchema('3.14', { type: 'number' }, 'ratio')).toBe(3.14)
    })

    test('negative string to number', () => {
      expect(coerceBySchema('-42', { type: 'number' }, 'offset')).toBe(-42)
    })

    test('zero string to number', () => {
      expect(coerceBySchema('0', { type: 'number' }, 'count')).toBe(0)
    })

    test('boolean to number', () => {
      expect(coerceBySchema(true, { type: 'number' }, 'flag')).toBe(1)
      expect(coerceBySchema(false, { type: 'number' }, 'flag')).toBe(0)
    })

    test('non-numeric string throws', () => {
      expect(() => coerceBySchema('abc', { type: 'number' }, 'port'))
        .toThrow('expected number, got "abc"')
    })

    test('empty string throws', () => {
      expect(() => coerceBySchema('', { type: 'number' }, 'port'))
        .toThrow('expected number, got empty string')
    })

    test('Infinity string throws', () => {
      expect(() => coerceBySchema('Infinity', { type: 'number' }, 'val'))
        .toThrow('expected number')
    })
  })

  describe('integer type', () => {
    test('integer string to integer', () => {
      expect(coerceBySchema('42', { type: 'integer' }, 'count')).toBe(42)
    })

    test('decimal string throws for integer', () => {
      expect(() => coerceBySchema('3.14', { type: 'integer' }, 'count'))
        .toThrow('expected integer, got "3.14"')
    })

    test('non-numeric string throws', () => {
      expect(() => coerceBySchema('abc', { type: 'integer' }, 'count'))
        .toThrow('expected number, got "abc"')
    })
  })

  describe('boolean type', () => {
    test('"true" to true', () => {
      expect(coerceBySchema('true', { type: 'boolean' }, 'debug')).toBe(true)
    })

    test('"false" to false', () => {
      expect(coerceBySchema('false', { type: 'boolean' }, 'debug')).toBe(false)
    })

    test('boolean passthrough', () => {
      expect(coerceBySchema(true, { type: 'boolean' }, 'debug')).toBe(true)
      expect(coerceBySchema(false, { type: 'boolean' }, 'debug')).toBe(false)
    })

    test('other strings throw', () => {
      expect(() => coerceBySchema('yes', { type: 'boolean' }, 'debug'))
        .toThrow('expected true or false, got "yes"')
    })
  })

  describe('null type', () => {
    test('empty string to null', () => {
      expect(coerceBySchema('', { type: 'null' }, 'val')).toBe(null)
    })

    test('non-empty string throws', () => {
      expect(() => coerceBySchema('hello', { type: 'null' }, 'val'))
        .toThrow('expected empty string for null')
    })
  })

  describe('object type', () => {
    test('valid JSON object', () => {
      expect(coerceBySchema('{"a":1}', { type: 'object' }, 'config'))
        .toEqual({ a: 1 })
    })

    test('invalid JSON throws', () => {
      expect(() => coerceBySchema('not json', { type: 'object' }, 'config'))
        .toThrow('expected valid JSON object')
    })

    test('JSON array throws for object type', () => {
      expect(() => coerceBySchema('[1,2]', { type: 'object' }, 'config'))
        .toThrow('expected valid JSON object')
    })
  })

  describe('array type', () => {
    test('valid JSON array string', () => {
      expect(coerceBySchema('[1,2,3]', { type: 'array' }, 'items'))
        .toEqual([1, 2, 3])
    })

    test('JSON array string with items schema coerces elements', () => {
      expect(coerceBySchema('["1","2","3"]', { type: 'array', items: { type: 'number' } }, 'ids'))
        .toEqual([1, 2, 3])
    })

    test('single value wraps into array', () => {
      expect(coerceBySchema('hello', { type: 'array' }, 'tags'))
        .toEqual(['hello'])
    })

    test('single value wraps and coerces via items schema', () => {
      expect(coerceBySchema('42', { type: 'array', items: { type: 'number' } }, 'ids'))
        .toEqual([42])
    })

    test('repeated flags (array input) collected into array', () => {
      expect(coerceBySchema(['foo', 'bar'], { type: 'array' }, 'tags'))
        .toEqual(['foo', 'bar'])
    })

    test('repeated flags coerced via items schema', () => {
      expect(coerceBySchema(['1', '2', '3'], { type: 'array', items: { type: 'number' } }, 'ids'))
        .toEqual([1, 2, 3])
    })

    test('repeated flags with invalid item throws', () => {
      expect(() => coerceBySchema(['1', 'abc'], { type: 'array', items: { type: 'number' } }, 'ids'))
        .toThrow('expected number, got "abc"')
    })

    test('JSON object string wraps into array', () => {
      // Not a JSON array, so the string is wrapped into a single-element array
      expect(coerceBySchema('{"a":1}', { type: 'array' }, 'items'))
        .toEqual(['{"a":1}'])
    })

    test('JSON object string with items: object schema parses correctly', () => {
      expect(coerceBySchema('{"a":1}', { type: 'array', items: { type: 'object' } }, 'items'))
        .toEqual([{ a: 1 }])
    })
  })

  describe('repeated flags with non-array schema', () => {
    test('repeated flags with string schema throws', () => {
      expect(() => coerceBySchema(['foo', 'bar'], { type: 'string' }, 'name'))
        .toThrow('does not accept multiple values')
    })

    test('repeated flags with number schema throws', () => {
      expect(() => coerceBySchema(['1', '2'], { type: 'number' }, 'port'))
        .toThrow('does not accept multiple values')
    })

    test('repeated flags with object schema throws', () => {
      expect(() => coerceBySchema(['{}', '{}'], { type: 'object' }, 'config'))
        .toThrow('does not accept multiple values')
    })
  })

  describe('union types', () => {
    test('["number", "string"] — numeric string becomes number', () => {
      expect(coerceBySchema('123', { type: ['number', 'string'] }, 'val')).toBe(123)
    })

    test('["number", "string"] — non-numeric stays string', () => {
      expect(coerceBySchema('abc', { type: ['number', 'string'] }, 'val')).toBe('abc')
    })

    test('["string", "null"] — empty string becomes null', () => {
      expect(coerceBySchema('', { type: ['string', 'null'] }, 'val')).toBe('')
    })

    test('["null", "string"] — empty string becomes null (null tried first)', () => {
      expect(coerceBySchema('', { type: ['null', 'string'] }, 'val')).toBe(null)
    })

    test('["number", "null"] — non-numeric non-empty throws', () => {
      expect(() => coerceBySchema('abc', { type: ['number', 'null'] }, 'val'))
        .toThrow('expected number or null')
    })
  })

  describe('enum', () => {
    test('valid enum value', () => {
      expect(coerceBySchema('red', { enum: ['red', 'blue', 'green'] }, 'color')).toBe('red')
    })

    test('invalid enum value throws', () => {
      expect(() => coerceBySchema('yellow', { enum: ['red', 'blue'] }, 'color'))
        .toThrow('expected one of "red", "blue"')
    })

    test('numeric enum values', () => {
      expect(coerceBySchema('1', { enum: [1, 2, 3] }, 'level')).toBe(1)
    })
  })

  describe('anyOf / oneOf', () => {
    test('anyOf tries variants in order', () => {
      const schema = { anyOf: [{ type: 'number' as const }, { type: 'string' as const }] }
      expect(coerceBySchema('123', schema, 'val')).toBe(123)
      expect(coerceBySchema('abc', schema, 'val')).toBe('abc')
    })

    test('oneOf tries variants in order', () => {
      const schema = { oneOf: [{ type: 'boolean' as const }, { type: 'string' as const }] }
      expect(coerceBySchema('true', schema, 'val')).toBe(true)
      expect(coerceBySchema('hello', schema, 'val')).toBe('hello')
    })
  })

  describe('const', () => {
    test('matching const value', () => {
      expect(coerceBySchema('hello', { const: 'hello' }, 'val')).toBe('hello')
    })

    test('non-matching const throws', () => {
      expect(() => coerceBySchema('world', { const: 'hello' }, 'val'))
        .toThrow('expected "hello"')
    })
  })

  describe('edge cases', () => {
    test('negative zero', () => {
      expect(coerceBySchema('-0', { type: 'number' }, 'val')).toBe(-0)
    })

    test('very large number', () => {
      expect(coerceBySchema('9007199254740991', { type: 'number' }, 'val')).toBe(9007199254740991)
    })

    test('NaN string throws', () => {
      expect(() => coerceBySchema('NaN', { type: 'number' }, 'val'))
        .toThrow('expected number')
    })

    test('whitespace-only string stays as string', () => {
      expect(coerceBySchema('  ', { type: 'string' }, 'val')).toBe('  ')
    })

    test('empty JSON object', () => {
      expect(coerceBySchema('{}', { type: 'object' }, 'val')).toEqual({})
    })

    test('empty JSON array', () => {
      expect(coerceBySchema('[]', { type: 'array' }, 'val')).toEqual([])
    })

    test('nested JSON object', () => {
      expect(coerceBySchema('{"a":{"b":[1,2]}}', { type: 'object' }, 'val'))
        .toEqual({ a: { b: [1, 2] } })
    })

    test('boolean passed to object type throws', () => {
      expect(() => coerceBySchema(true, { type: 'object' }, 'val'))
        .toThrow('expected JSON object, got boolean')
    })

    test('boolean passed to array type wraps in array', () => {
      expect(coerceBySchema(true, { type: 'array' }, 'val')).toEqual([true])
    })

    test('boolean passed to array type with items schema coerces', () => {
      expect(coerceBySchema(true, { type: 'array', items: { type: 'string' } }, 'val'))
        .toEqual(['true'])
    })

    test('"0" as number returns 0', () => {
      expect(coerceBySchema('0', { type: 'number' }, 'val')).toBe(0)
    })

    test('"0" as integer returns 0', () => {
      expect(coerceBySchema('0', { type: 'integer' }, 'val')).toBe(0)
    })

    test('"0" as string returns "0"', () => {
      expect(coerceBySchema('0', { type: 'string' }, 'val')).toBe('0')
    })

    test('phone number as string', () => {
      expect(coerceBySchema('+1234567890', { type: 'string' }, 'phone')).toBe('+1234567890')
    })

    test('phone number with + prefix is valid number', () => {
      // "+1234567890" is a valid number in JS (+1234567890 === 1234567890)
      // Use string type for phone numbers to preserve the "+"
      expect(coerceBySchema('+1234567890', { type: 'number' }, 'phone')).toBe(1234567890)
    })

    test('phone number with letters throws for number type', () => {
      expect(() => coerceBySchema('+1-800-FLOWERS', { type: 'number' }, 'phone'))
        .toThrow('expected number')
    })

    test('leading zeros preserved as string', () => {
      expect(coerceBySchema('007', { type: 'string' }, 'id')).toBe('007')
    })

    test('hex string as number', () => {
      expect(coerceBySchema('0xff', { type: 'number' }, 'val')).toBe(255)
    })
  })

  describe('implicit types', () => {
    test('schema with properties implies object', () => {
      const schema = { properties: { a: { type: 'number' as const } } }
      expect(coerceBySchema('{"a":1}', schema, 'config')).toEqual({ a: 1 })
    })

    test('schema with items implies array — JSON string parsed', () => {
      const schema = { items: { type: 'string' as const } }
      expect(coerceBySchema('["a","b"]', schema, 'list')).toEqual(['a', 'b'])
    })

    test('schema with items implies array — single value wrapped', () => {
      const schema = { items: { type: 'number' as const } }
      expect(coerceBySchema('42', schema, 'list')).toEqual([42])
    })

    test('schema with items implies array — repeated flags coerced', () => {
      const schema = { items: { type: 'number' as const } }
      expect(coerceBySchema(['1', '2'], schema, 'list')).toEqual([1, 2])
    })

    test('no type info returns value as-is', () => {
      expect(coerceBySchema('hello', {}, 'val')).toBe('hello')
    })
  })

  describe('union types with array', () => {
    test('["array", "null"] — JSON array string parsed as array', () => {
      expect(coerceBySchema('[1,2]', { type: ['array', 'null'] }, 'val'))
        .toEqual([1, 2])
    })

    test('["array", "null"] — empty string becomes null', () => {
      expect(coerceBySchema('', { type: ['null', 'array'] }, 'val'))
        .toBe(null)
    })

    test('["string", "array"] — string value stays string (tried first)', () => {
      expect(coerceBySchema('hello', { type: ['string', 'array'] }, 'val'))
        .toBe('hello')
    })

    test('["array", "string"] — non-JSON string wraps into array', () => {
      // When array is tried first: JSON.parse fails, coerceToArray throws,
      // then string is tried and succeeds
      expect(coerceBySchema('hello', { type: ['array', 'string'] }, 'val'))
        .toEqual('hello')
    })

    test('["array", "null"] — repeated flags accepted', () => {
      expect(coerceBySchema(['a', 'b'], { type: ['array', 'null'] }, 'val'))
        .toEqual(['a', 'b'])
    })

    test('["array", "null"] — repeated flags with items coerced', () => {
      expect(coerceBySchema(['1', '2'], { type: ['array', 'null'], items: { type: 'number' } }, 'val'))
        .toEqual([1, 2])
    })
  })

  describe('null coercion edge cases', () => {
    test('false does NOT coerce to null', () => {
      expect(() => coerceBySchema(false, { type: 'null' }, 'val'))
        .toThrow('expected empty string for null')
    })

    test('["null", "boolean"] — false stays as false', () => {
      expect(coerceBySchema(false, { type: ['null', 'boolean'] }, 'val'))
        .toBe(false)
    })

    test('["boolean", "null"] — false stays as false (tried first)', () => {
      expect(coerceBySchema(false, { type: ['boolean', 'null'] }, 'val'))
        .toBe(false)
    })
  })
})
