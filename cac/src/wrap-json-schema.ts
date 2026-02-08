/**
 * Wraps a plain JSON Schema object into a StandardJSONSchemaV1-compatible object.
 *
 * This is useful for dynamic use cases where you have a raw JSON Schema
 * (e.g. from an MCP tool's inputSchema) and need to pass it to CAC's
 * schema option which expects StandardJSONSchemaV1.
 *
 * @example
 * ```ts
 * import { wrapJsonSchema } from '@xmorse/cac'
 *
 * // Wrap a plain JSON Schema for use with CAC options
 * const schema = wrapJsonSchema({ type: "number" })
 * cmd.option('--port <port>', 'Port', { schema })
 *
 * // Wrap MCP tool property schemas
 * for (const [name, propSchema] of Object.entries(tool.inputSchema.properties)) {
 *   cmd.option(`--${name} <${name}>`, desc, { schema: wrapJsonSchema(propSchema) })
 * }
 * ```
 */

import type { StandardJSONSchemaV1 } from "./standard-schema.js"

/**
 * Wraps a plain JSON Schema object into a StandardJSONSchemaV1-compatible object.
 * The returned object can be passed to CAC's `schema` option config.
 *
 * @param jsonSchema - A plain JSON Schema object (e.g. `{ type: "number" }`)
 * @returns A StandardJSONSchemaV1-compatible object that CAC can use for coercion
 */
export function wrapJsonSchema(jsonSchema: Record<string, unknown>): StandardJSONSchemaV1 {
  return {
    "~standard": {
      version: 1,
      vendor: "cac",
      jsonSchema: {
        input: () => jsonSchema,
        output: () => jsonSchema,
      },
    },
  }
}
