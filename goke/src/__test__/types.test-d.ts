/**
 * Type-level tests for schema-based option inference.
 * These tests verify that TypeScript infers the correct types from
 * option names (template literals) and StandardJSONSchemaV1 schemas.
 *
 * These use expectTypeOf from vitest for compile-time type assertions.
 */
import { describe, test, expectTypeOf } from 'vitest'
import type { StandardTypedV1 } from '../coerce.js'

// ─── Import type helpers from Command.ts ───
// We can't import the private types directly, so we reconstruct them here
// to verify the type-level logic works correctly.

type CamelCase<S extends string> =
  S extends `${infer L}-${infer R}`
    ? `${L}${CamelCase<Capitalize<R>>}`
    : S

type ExtractOptionName<S extends string> =
  S extends `${string}--${infer Name} <${string}>` ? CamelCase<Name> :
  S extends `${string}--${infer Name} [${string}]` ? CamelCase<Name> :
  S extends `${string}--${infer Name}` ? CamelCase<Name> :
  string

type IsOptionalOption<S extends string> =
  S extends `${string}<${string}>` ? false :
  true

type InferSchemaOutput<S> =
  S extends StandardTypedV1<any, infer O> ? O : unknown

describe('type-level: ExtractOptionName', () => {
  test('extracts name from --name <value>', () => {
    expectTypeOf<ExtractOptionName<'--port <port>'>>().toEqualTypeOf<'port'>()
  })

  test('extracts name from --name [value]', () => {
    expectTypeOf<ExtractOptionName<'--host [host]'>>().toEqualTypeOf<'host'>()
  })

  test('extracts name from --name (boolean)', () => {
    expectTypeOf<ExtractOptionName<'--verbose'>>().toEqualTypeOf<'verbose'>()
  })

  test('extracts name with alias -p, --port <port>', () => {
    expectTypeOf<ExtractOptionName<'-p, --port <port>'>>().toEqualTypeOf<'port'>()
  })

  test('camelCases kebab-case names', () => {
    expectTypeOf<ExtractOptionName<'--foo-bar <val>'>>().toEqualTypeOf<'fooBar'>()
  })

  test('camelCases multi-segment kebab-case', () => {
    expectTypeOf<ExtractOptionName<'--my-long-option <val>'>>().toEqualTypeOf<'myLongOption'>()
  })

})

describe('type-level: IsOptionalOption', () => {
  test('required option with <...>', () => {
    expectTypeOf<IsOptionalOption<'--port <port>'>>().toEqualTypeOf<false>()
  })

  test('optional option with [...]', () => {
    expectTypeOf<IsOptionalOption<'--host [host]'>>().toEqualTypeOf<true>()
  })

  test('boolean flag is optional', () => {
    expectTypeOf<IsOptionalOption<'--verbose'>>().toEqualTypeOf<true>()
  })
})

describe('type-level: InferSchemaOutput', () => {
  test('infers output from StandardTypedV1', () => {
    type Schema = StandardTypedV1<unknown, number>
    expectTypeOf<InferSchemaOutput<Schema>>().toEqualTypeOf<number>()
  })

  test('infers string output', () => {
    type Schema = StandardTypedV1<unknown, string>
    expectTypeOf<InferSchemaOutput<Schema>>().toEqualTypeOf<string>()
  })

  test('infers boolean output', () => {
    type Schema = StandardTypedV1<unknown, boolean>
    expectTypeOf<InferSchemaOutput<Schema>>().toEqualTypeOf<boolean>()
  })

  test('falls back to unknown for non-schema', () => {
    expectTypeOf<InferSchemaOutput<{ foo: string }>>().toEqualTypeOf<unknown>()
  })
})

describe('type-level: CamelCase', () => {
  test('simple kebab', () => {
    expectTypeOf<CamelCase<'foo-bar'>>().toEqualTypeOf<'fooBar'>()
  })

  test('multi-segment', () => {
    expectTypeOf<CamelCase<'foo-bar-baz'>>().toEqualTypeOf<'fooBarBaz'>()
  })

  test('no hyphens passthrough', () => {
    expectTypeOf<CamelCase<'port'>>().toEqualTypeOf<'port'>()
  })

  test('single char segments', () => {
    expectTypeOf<CamelCase<'a-b-c'>>().toEqualTypeOf<'aBC'>()
  })
})
