import CAC from "./CAC.js"
import Command from "./Command.js"

/**
 * @param name The program name to display in help and version message
 */
const cac = (name = '') => new CAC(name)

export default cac
export { cac, CAC, Command }
export type { OptionConfig } from "./Option.js"
export type { StandardTypedV1, StandardJSONSchemaV1 } from "./standard-schema.js"
export type { JsonSchema } from "./coerce.js"
export { coerceBySchema, extractJsonSchema } from "./coerce.js"
export { wrapJsonSchema } from "./wrap-json-schema.js"
