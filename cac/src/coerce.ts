/**
 * JSON Schema-based coercion for CLI arguments.
 *
 * CLI arguments are always strings (or booleans for flags). This module
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
}

/**
 * Check if a JSON Schema expects an array type.
 * Handles direct type, type unions, and implicit array (has "items" without type).
 */
function schemaIncludesArray(schema: JsonSchema): boolean {
  const type = schema.type
  if (type === 'array') return true
  if (Array.isArray(type) && type.includes('array')) return true
  // Implicit array: has items property without explicit type
  if (!type && schema.items) return true
  return false
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
  // Cast to JsonSchema for typed access — Record<string, unknown> from StandardJSONSchemaV1
  // has the same shape at runtime
  const schema = rawSchema as JsonSchema

  // Handle array values from repeated flags (e.g. --tag foo --tag bar → ["foo", "bar"]).
  // Only schemas with type "array" (or union including "array") accept repeated flags.
  // Non-array schemas reject repeated flags — the user must use an array schema to opt in.
  if (Array.isArray(value)) {
    if (schemaIncludesArray(schema)) {
      // Schema expects an array — coerce each element via items schema if present
      if (schema.items) {
        return value.map((v) => coerceBySchema(v, schema.items!, optionName))
      }
      return value
    }
    // Schema does NOT expect array — repeated flags are not allowed
    throw new Error(
      `Option --${optionName} does not accept multiple values. ` +
      `Use an array schema (e.g. { type: "array" }) to allow repeated flags.`
    )
  }

  // Handle array schema with a single (non-array) value.
  // A single value is wrapped into a one-element array, with item coercion via schema.items.
  // If the string is valid JSON array, parse it instead (e.g. --items '[1,2,3]').
  if (schemaIncludesArray(schema)) {
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
    throw new Error(
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
    throw new Error(
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
    throw new Error(
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
    throw new Error(
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
    throw new Error(`Invalid value for --${optionName}: expected number, got empty string`)
  }
  const num = +value
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid value for --${optionName}: expected number, got ${JSON.stringify(value)}`)
  }
  return num
}

function coerceToInteger(value: string | boolean, optionName: string): number {
  const num = coerceToNumber(value, optionName)
  if (num % 1 !== 0) {
    throw new Error(`Invalid value for --${optionName}: expected integer, got ${JSON.stringify(value)}`)
  }
  return num
}

function coerceToBoolean(value: string | boolean, optionName: string): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(
    `Invalid value for --${optionName}: expected true or false, got ${JSON.stringify(value)}`
  )
}

function coerceToNull(value: string | boolean, optionName: string): null {
  if (typeof value === 'string' && value === '') return null
  if (value === false) return null
  throw new Error(
    `Invalid value for --${optionName}: expected empty string for null, got ${JSON.stringify(value)}`
  )
}

function coerceToObject(value: string | boolean, optionName: string): Record<string, unknown> {
  if (typeof value !== 'string') {
    throw new Error(`Invalid value for --${optionName}: expected JSON object, got ${typeof value}`)
  }
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new Error(
      `Invalid value for --${optionName}: expected valid JSON object, got ${JSON.stringify(value)}`
    )
  }
}

function coerceToArray(value: string | boolean, optionName: string): unknown[] {
  if (typeof value !== 'string') {
    throw new Error(`Invalid value for --${optionName}: expected JSON array, got ${typeof value}`)
  }
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      throw new Error('not an array')
    }
    return parsed
  } catch {
    throw new Error(
      `Invalid value for --${optionName}: expected valid JSON array, got ${JSON.stringify(value)}`
    )
  }
}

/**
 * Extract JSON Schema from a StandardJSONSchemaV1-compatible object.
 * Returns the JSON Schema as a plain object, or undefined if not available.
 */
export function extractJsonSchema(schema: unknown): Record<string, unknown> | undefined {
  if (
    schema &&
    typeof schema === 'object' &&
    '~standard' in schema
  ) {
    const std = (schema as Record<string, any>)['~standard']
    if (std && typeof std === 'object' && 'jsonSchema' in std) {
      const converter = std.jsonSchema
      if (converter && typeof converter.input === 'function') {
        try {
          return converter.input({ target: 'draft-2020-12' }) as Record<string, unknown>
        } catch {
          // Fallback: try draft-07
          try {
            return converter.input({ target: 'draft-07' }) as Record<string, unknown>
          } catch {
            return undefined
          }
        }
      }
    }
  }
  return undefined
}
