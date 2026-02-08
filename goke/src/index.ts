import Goke from "./goke.js"
import type { GokeOptions } from "./goke.js"
import Command from "./Command.js"

/**
 * @param name The program name to display in help and version message
 * @param options Configuration for stdout, stderr, and argv
 */
const goke = (name = '', options?: GokeOptions) => new Goke(name, options)

export default goke
export { goke, Goke, Command }
export { createConsole } from "./goke.js"
export type { GokeOutputStream, GokeConsole, GokeOptions } from "./goke.js"
export type { OptionConfig } from "./Option.js"
export type { StandardTypedV1, StandardJSONSchemaV1 } from "./standard-schema.js"
export type { JsonSchema } from "./coerce.js"
export { coerceBySchema, extractJsonSchema } from "./coerce.js"
export { wrapJsonSchema } from "./wrap-json-schema.js"
