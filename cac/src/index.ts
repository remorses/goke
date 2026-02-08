import CAC from "./CAC.js"
import Command from "./Command.js"

/**
 * @param name The program name to display in help and version message
 */
const cac = (name = '') => new CAC(name)

export default cac
export { cac, CAC, Command }
