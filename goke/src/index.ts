import Goke from "./goke.js"
import Command from "./Command.js"

/**
 * @param name The program name to display in help and version message
 */
const goke = (name = '') => new Goke(name)

export default goke
export { goke, Goke, Command }
export type { OptionConfig } from "./Option.js"
export type { StandardTypedV1, StandardJSONSchemaV1 } from "./standard-schema.js"
export type { JsonSchema } from "./coerce.js"
export { coerceBySchema, extractJsonSchema } from "./coerce.js"
export { wrapJsonSchema } from "./wrap-json-schema.js"
