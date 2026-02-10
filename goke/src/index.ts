import Goke from "./goke.js"
import type { GokeOptions } from "./goke.js"
import { Command } from "./goke.js"

/**
 * @param name The program name to display in help and version message
 * @param options Configuration for stdout, stderr, and argv
 */
const goke = (name = '', options?: GokeOptions) => new Goke(name, options)

export default goke
export { goke, Goke, Command }
export { createConsole } from "./goke.js"
export type { GokeOutputStream, GokeConsole, GokeOptions } from "./goke.js"
export type { StandardTypedV1, StandardJSONSchemaV1, JsonSchema } from "./coerce.js"
export { GokeError, coerceBySchema, extractJsonSchema, wrapJsonSchema, isStandardSchema, extractSchemaMetadata } from "./coerce.js"
