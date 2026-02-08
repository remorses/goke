import { removeBrackets, camelcaseOptionName } from "./utils.js"
import type { StandardJSONSchemaV1 } from "./standard-schema.js"

interface OptionConfig {
  default?: any
  /**
   * A Standard JSON Schema V1-compatible object for this option.
   * Used for both runtime coercion (string→typed value) and TypeScript type inference.
   *
   * Accepts any object implementing StandardJSONSchemaV1, e.g.:
   * - Zod schemas: z.number() (Zod v4.2+ implements StandardJSONSchemaV1)
   * - Valibot: toStandardJsonSchema(v.number())
   * - ArkType: type("number")
   * - Plain wrapper: wrapJsonSchema({ type: "number" })
   *
   * At runtime, JSON Schema is extracted via schema['~standard'].jsonSchema.input()
   * and used by coerceBySchema() to convert CLI strings to typed values.
   */
  schema?: StandardJSONSchemaV1
}

export default class Option {
  /** Option name */
  name: string
  /** Option name and aliases */
  names: string[]
  isBoolean?: boolean
  // `required` will be a boolean for options with brackets
  required?: boolean
  config: OptionConfig
  negated: boolean

  constructor(
    public rawName: string,
    public description: string,
    config?: OptionConfig
  ) {
    this.config = Object.assign({}, config)

    // You may use cli.option('--env.* [value]', 'desc') to denote a dot-nested option
    rawName = rawName.replace(/\.\*/g, '')

    this.negated = false
    this.names = removeBrackets(rawName)
      .split(',')
      .map((v: string) => {
        let name = v.trim().replace(/^-{1,2}/, '')
        if (name.startsWith('no-')) {
          this.negated = true
          name = name.replace(/^no-/, '')
        }

        return camelcaseOptionName(name)
      })
      .sort((a, b) => (a.length > b.length ? 1 : -1)) // Sort names

    // Use the longest name (last one) as actual option name
    this.name = this.names[this.names.length - 1]

    if (this.negated && this.config.default == null) {
      this.config.default = true
    }

    if (rawName.includes('<')) {
      this.required = true
    } else if (rawName.includes('[')) {
      this.required = false
    } else {
      // No arg needed, it's boolean flag
      this.isBoolean = true
    }
  }
}

export type { OptionConfig }
