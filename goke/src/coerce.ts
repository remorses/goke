/**
 * JSON Schema coercion and Standard Schema types for CLI arguments.
 *
 * This module contains:
 * - Standard Schema types vendored from @standard-schema/spec v1.1.0
 * - wrapJsonSchema() to convert plain JSON Schema into StandardJSONSchemaV1
 * - coerceBySchema() for type-safe CLI argument coercion
 * - extractJsonSchema() to pull JSON Schema from StandardJSONSchemaV1 objects
 *
 * CLI arguments are always strings (or booleans for flags). coerceBySchema()
 * coerces raw string values to the types declared in a JSON Schema,
 * following Ajv's well-established coercion rules for string→X conversion.
 *
 * Coercion rules (string input):
 *   string  → string    (no-op)
 *   string  → number    (+value, must be valid finite number)
 *   string  → integer   (+value, must be valid integer)
 *   string  → boolean   ("true"→true, "false"→false, nothing else)
 *   string  → null      (""→null, nothing else)
 *   string  → object    (JSON.parse, must produce object)
 *   string  → array     (JSON.parse, must produce array)
 *
 * Boolean input (from mri flags):
 *   boolean → boolean   (no-op)
 *   boolean → string    (true→"true", false→"false")
 *   boolean → number    (true→1, false→0)
 *
 * Union types (e.g. ["number", "string"]):
 *   Tries each type in order, returns first successful coercion.
 */

// ─── GokeError ───

/**
 * Custom error class for CLI usage errors (unknown options, missing values,
 * invalid types, etc.). Used by both the coercion layer and the framework
 * to distinguish user-facing errors from unexpected failures.
 */
export class GokeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor)
    } else {
      this.stack = new Error(message).stack
    }
  }
}

// ─── Standard Schema types (vendored from @standard-schema/spec v1.1.0) ───
// https://github.com/standard-schema/standard-schema
//
// We vendor these ~80 lines of pure types instead of adding a runtime dependency.
// Goke uses StandardJSONSchemaV1 to accept schemas from Zod, Valibot, ArkType, etc.
// and extract JSON Schema for CLI argument coercion + TypeScript type inference.

/** The Standard Typed interface. Base type extended by other specs. */
export interface StandardTypedV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardTypedV1.Props<Input, Output>;
}

export declare namespace StandardTypedV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: Types<Input, Output> | undefined;
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  export type InferInput<Schema extends StandardTypedV1> = NonNullable<
    Schema["~standard"]["types"]
  >["input"];

  export type InferOutput<Schema extends StandardTypedV1> = NonNullable<
    Schema["~standard"]["types"]
  >["output"];
}

/** The Standard JSON Schema interface. */
export interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardJSONSchemaV1.Props<Input, Output>;
}

export declare namespace StandardJSONSchemaV1 {
  export interface Props<Input = unknown, Output = Input>
    extends StandardTypedV1.Props<Input, Output> {
    readonly jsonSchema: StandardJSONSchemaV1.Converter;
  }

  export interface Converter {
    readonly input: (
      options: StandardJSONSchemaV1.Options,
    ) => Record<string, unknown>;
    readonly output: (
      options: StandardJSONSchemaV1.Options,
    ) => Record<string, unknown>;
  }

  export type Target =
    | "draft-2020-12"
    | "draft-07"
    | "openapi-3.0"
    | ({} & string);

  export interface Options {
    readonly target: Target;
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }

  export interface Types<Input = unknown, Output = Input>
    extends StandardTypedV1.Types<Input, Output> {}

  export type InferInput<Schema extends StandardTypedV1> =
    StandardTypedV1.InferInput<Schema>;

  export type InferOutput<Schema extends StandardTypedV1> =
    StandardTypedV1.InferOutput<Schema>;
}

// ─── wrapJsonSchema ───

/**
 * Wraps a plain JSON Schema object into a StandardJSONSchemaV1-compatible object.
 *
 * @internal This is an internal helper used by @goke/mcp to wrap MCP tool schemas.
 * Users should pass Zod or other StandardSchema-compatible schemas to `.option()`.
 *
 * @param jsonSchema - A plain JSON Schema object (e.g. `{ type: "number" }`)
 * @returns A StandardJSONSchemaV1-compatible object that Goke can use for coercion
 */
export function wrapJsonSchema(jsonSchema: Record<string, unknown>): StandardJSONSchemaV1 {
  return {
    "~standard": {
      version: 1,
      vendor: "goke",
      jsonSchema: {
        input: () => jsonSchema,
        output: () => jsonSchema,
      },
    },
  }
}

// ─── JSON Schema coercion ───

/** Minimal JSON Schema interface — only what we need for CLI coercion. */
export interface JsonSchema {
  type?: string | string[]
  enum?: unknown[]
  const?: unknown
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  allOf?: JsonSchema[]
  additionalProperties?: boolean | JsonSchema
  default?: unknown
  description?: string
  /** JSON Schema deprecated annotation (draft 2019-09+) */
  deprecated?: boolean
}

/**
 * Check if a JSON Schema expects exclusively an array type.
 * Returns true only when the schema unambiguously requires an array:
 * - type is exactly "array"
 * - no type but has "items" (implicit array)
 *
 * Union types like ["array", "null"] are NOT matched here — they go through
 * the normal union handler so type order is respected.
 */
function schemaIsArray(schema: JsonSchema): boolean {
  if (schema.type === 'array') return true
  // Implicit array: has items property without explicit type
  if (!schema.type && schema.items) return true
  return false
}

/**
 * Normalize a raw schema object (Record<string, unknown>) into a typed JsonSchema.
 * Validates that the input is a non-null object and maps known fields.
 */
function normalizeJsonSchema(raw: JsonSchema | Record<string, unknown>): JsonSchema {
  if (!raw || typeof raw !== 'object') {
    return {}
  }
  // If already a JsonSchema (has known fields at correct types), return directly.
  // Otherwise, extract known JSON Schema fields from the raw record.
  return raw as JsonSchema
}

/**
 * Coerce a raw CLI value to the type declared in a JSON Schema.
 *
 * @param value - Raw value from mri (string for value options, boolean for flags)
 * @param schema - JSON Schema describing the expected type
 * @param optionName - Option name for error messages (e.g. "port")
 * @returns The coerced value matching the schema type
 * @throws Error with human-readable message if coercion fails
 */
export function coerceBySchema(
  value: string | boolean | string[],
  rawSchema: JsonSchema | Record<string, unknown>,
  optionName: string,
): unknown {
  const schema = normalizeJsonSchema(rawSchema)

  // Handle array values from repeated flags (e.g. --tag foo --tag bar → ["foo", "bar"]).
  // Only schemas with type "array" accept repeated flags.
  // Non-array schemas reject repeated flags — the user must use an array schema to opt in.
  if (Array.isArray(value)) {
    if (schemaIsArray(schema)) {
      // Schema expects an array — coerce each element via items schema if present
      if (schema.items) {
        return value.map((v) => coerceBySchema(v, schema.items!, optionName))
      }
      return value
    }
    // Check union types — if any type in the union is "array", accept repeated flags
    if (Array.isArray(schema.type) && schema.type.includes('array')) {
      if (schema.items) {
        return value.map((v) => coerceBySchema(v, schema.items!, optionName))
      }
      return value
    }
    // Check anyOf/oneOf — if any variant is an array schema, accept repeated flags
    const unionVariants = schema.anyOf || schema.oneOf
    if (unionVariants) {
      const arrayVariant = unionVariants.find(v => schemaIsArray(v))
      if (arrayVariant) {
        const itemsSchema = arrayVariant.items
        if (itemsSchema) {
          return value.map((v) => coerceBySchema(v, itemsSchema, optionName))
        }
        return value
      }
    }
    // Schema does NOT expect array — repeated flags are not allowed
    throw new GokeError(
      `Option --${optionName} does not accept multiple values. ` +
      `Use an array schema (e.g. { type: "array" }) to allow repeated flags.`
    )
  }

  // Handle array schema with a single (non-array) value.
  // A single value is wrapped into a one-element array, with item coercion via schema.items.
  // If the string is valid JSON array, parse it instead (e.g. --items '[1,2,3]').
  if (schemaIsArray(schema)) {
    if (typeof value === 'string') {
      // Try JSON parse first — if it's a valid JSON array, use that
      try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) {
          if (schema.items) {
            return parsed.map((item: unknown) => {
              // JSON-parsed items are already typed (number, string, etc.)
              // Only coerce if they're strings/booleans (CLI-like values)
              if (typeof item === 'string' || typeof item === 'boolean') {
                return coerceBySchema(item, schema.items!, optionName)
              }
              return item
            })
          }
          return parsed
        }
      } catch {
        // Not valid JSON — fall through to wrap
      }
    }
    // Wrap single value in array, coercing via items schema if present
    if (schema.items) {
      return [coerceBySchema(value, schema.items, optionName)]
    }
    return [value]
  }

  // Handle enum constraint — value must match one of the allowed values
  if (schema.enum) {
    // Try coercing to each enum value's type first
    for (const allowed of schema.enum) {
      if (typeof allowed === 'number') {
        const num = +String(value)
        if (num * 0 === 0 && num === allowed) return num
      } else if (typeof allowed === 'boolean') {
        if (value === 'true' && allowed === true) return true
        if (value === 'false' && allowed === false) return false
        if (value === allowed) return value
      } else if (String(value) === String(allowed)) {
        return allowed
      }
    }
    throw new GokeError(
      `Invalid value for --${optionName}: expected one of ${schema.enum.map(v => JSON.stringify(v)).join(', ')}, got ${JSON.stringify(value)}`
    )
  }

  // Handle const constraint
  if (schema.const !== undefined) {
    // Determine target type — typeof null === 'object' in JS, handle it specially
    const constVal = schema.const
    const targetType = constVal === null ? 'null' : typeof constVal as string
    const coerced = coerceToSingleType(value, targetType, optionName)
    if (coerced === constVal) return coerced
    throw new GokeError(
      `Invalid value for --${optionName}: expected ${JSON.stringify(constVal)}, got ${JSON.stringify(value)}`
    )
  }

  // Handle anyOf/oneOf — try each sub-schema
  if (schema.anyOf || schema.oneOf) {
    const variants = schema.anyOf || schema.oneOf || []
    for (const variant of variants) {
      try {
        return coerceBySchema(value, variant, optionName)
      } catch {
        // Try next variant
      }
    }
    throw new GokeError(
      `Invalid value for --${optionName}: ${JSON.stringify(value)} does not match any allowed type`
    )
  }

  // Handle allOf — value must satisfy all sub-schemas (coerce with first, validate with rest)
  if (schema.allOf && schema.allOf.length > 0) {
    return coerceBySchema(value, schema.allOf[0], optionName)
  }

  // Handle type field
  const schemaType = schema.type

  if (!schemaType) {
    // No type specified — check if it has object/array markers
    if (schema.properties || schema.additionalProperties) {
      return coerceToSingleType(value, 'object', optionName)
    }
    if (schema.items) {
      return coerceToSingleType(value, 'array', optionName)
    }
    // No type info at all — return as-is
    return value
  }

  // Union type: ["number", "string"], ["string", "null"], etc.
  if (Array.isArray(schemaType)) {
    // Try each type in order
    for (const t of schemaType) {
      try {
        return coerceToSingleType(value, t, optionName)
      } catch {
        // Try next type
      }
    }
    throw new GokeError(
      `Invalid value for --${optionName}: expected ${schemaType.join(' or ')}, got ${JSON.stringify(value)}`
    )
  }

  // Single type
  return coerceToSingleType(value, schemaType, optionName)
}

/**
 * Coerce a raw CLI value to a single JSON Schema type.
 */
function coerceToSingleType(
  value: string | boolean,
  targetType: string,
  optionName: string,
): unknown {
  switch (targetType) {
    case 'string':
      return coerceToString(value)
    case 'number':
      return coerceToNumber(value, optionName)
    case 'integer':
      return coerceToInteger(value, optionName)
    case 'boolean':
      return coerceToBoolean(value, optionName)
    case 'null':
      return coerceToNull(value, optionName)
    case 'object':
      return coerceToObject(value, optionName)
    case 'array':
      return coerceToArray(value, optionName)
    default:
      // Unknown type — return as-is
      return value
  }
}

function coerceToString(value: string | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return value
}

function coerceToNumber(value: string | boolean, optionName: string): number {
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }
  if (value === '') {
    throw new GokeError(`Invalid value for --${optionName}: expected number, got empty string`)
  }
  const num = +value
  if (!Number.isFinite(num)) {
    throw new GokeError(`Invalid value for --${optionName}: expected number, got ${JSON.stringify(value)}`)
  }
  return num
}

function coerceToInteger(value: string | boolean, optionName: string): number {
  const num = coerceToNumber(value, optionName)
  if (num % 1 !== 0) {
    throw new GokeError(`Invalid value for --${optionName}: expected integer, got ${JSON.stringify(value)}`)
  }
  return num
}

function coerceToBoolean(value: string | boolean, optionName: string): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (value === 'true') return true
  if (value === 'false') return false
  throw new GokeError(
    `Invalid value for --${optionName}: expected true or false, got ${JSON.stringify(value)}`
  )
}

function coerceToNull(value: string | boolean, optionName: string): null {
  if (typeof value === 'string' && value === '') return null
  throw new GokeError(
    `Invalid value for --${optionName}: expected empty string for null, got ${JSON.stringify(value)}`
  )
}

function coerceToObject(value: string | boolean, optionName: string): Record<string, unknown> {
  if (typeof value !== 'string') {
    throw new GokeError(`Invalid value for --${optionName}: expected JSON object, got ${typeof value}`)
  }
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new GokeError(
      `Invalid value for --${optionName}: expected valid JSON object, got ${JSON.stringify(value)}`
    )
  }
}

function coerceToArray(value: string | boolean, optionName: string): unknown[] {
  if (typeof value !== 'string') {
    throw new GokeError(`Invalid value for --${optionName}: expected JSON array, got ${typeof value}`)
  }
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      throw new Error('not an array')
    }
    return parsed
  } catch {
    throw new GokeError(
      `Invalid value for --${optionName}: expected valid JSON array, got ${JSON.stringify(value)}`
    )
  }
}

// ─── Schema extraction ───

/**
 * Type guard for the ~standard property shape on StandardJSONSchemaV1 objects.
 */
function hasStandardProp(schema: object): schema is { '~standard': { jsonSchema?: unknown } } {
  if (!('~standard' in schema)) return false
  const std = (schema as Record<string, unknown>)['~standard']
  return std != null && typeof std === 'object'
}

/**
 * Type guard for a JSON Schema converter object with an input() method.
 */
function isJsonSchemaConverter(converter: unknown): converter is { input: (opts: { target: string }) => Record<string, unknown> } {
  return converter != null && typeof converter === 'object' && 'input' in converter && typeof (converter as Record<string, unknown>).input === 'function'
}

/**
 * Extract JSON Schema from a StandardJSONSchemaV1-compatible object.
 * Returns the JSON Schema as a plain object, or undefined if not available.
 */
export function extractJsonSchema(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object') return undefined
  if (!hasStandardProp(schema)) return undefined

  const converter = schema['~standard'].jsonSchema
  if (!isJsonSchemaConverter(converter)) return undefined

  try {
    return converter.input({ target: 'draft-2020-12' })
  } catch {
    try {
      return converter.input({ target: 'draft-07' })
    } catch {
      return undefined
    }
  }
}

/**
 * Check if a value is a StandardJSONSchemaV1-compatible schema object.
 * Returns true when the value has a `~standard` property with a jsonSchema converter.
 */
export function isStandardSchema(value: unknown): value is StandardJSONSchemaV1 {
  if (!value || typeof value !== 'object') return false
  if (!hasStandardProp(value)) return false
  return isJsonSchemaConverter(value['~standard'].jsonSchema)
}

/**
 * Extract description, default value, and deprecated flag from a StandardJSONSchemaV1-compatible schema.
 * Calls extractJsonSchema() internally and pulls `description`, `default`, and `deprecated` fields.
 */
export function extractSchemaMetadata(schema: StandardJSONSchemaV1): { description?: string; default?: unknown; deprecated?: boolean } {
  const jsonSchema = extractJsonSchema(schema)
  if (!jsonSchema) return {}
  const result: { description?: string; default?: unknown; deprecated?: boolean } = {}
  if (typeof jsonSchema.description === 'string') {
    result.description = jsonSchema.description
  }
  if (jsonSchema.default !== undefined) {
    result.default = jsonSchema.default
  }
  if (jsonSchema.deprecated === true) {
    result.deprecated = true
  }
  return result
}
