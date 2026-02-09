const path = require('path')
const { SUPPORTED_SHELLS, SHELL_LOCATIONS } = require('./constants');
const prompt = require('./prompt');
const installer = require('./installer');
const { tabtabDebug } = require('./utils');

/**
 * @typedef {import('./constants').SupportedShell} SupportedShell
 */

// If TABTAB_DEBUG env is set, make it so that debug statements are also log to
// TABTAB_DEBUG file provided.
const debug = tabtabDebug('tabtab');

/**
 * Check if a shell is supported.
 * @param {String} shell - Shell to check.
 * @returns {shell is SupportedShell}
 */
const isShellSupported = shell => (/** @type {ReadonlyArray.<String>} */ (SUPPORTED_SHELLS)).includes(shell);

/**
 * This function is to be used inside a completer.
 *
 * An environment variable named `SHELL` shall be explicitly set
 * by the completion script when it invokes the completer.
 *
 * The value of `SHELL` is expected to be one of the supported shells.
 * If this expectation isn't met, it will result in an error.
 *
 * @example
 * const shell = getShellFromEnv(process.env)
 *
 * @param {Readonly.<Record.<String, String | undefined>>} env - Env objects that may contain `SHELL`, usually `process.env`.
 * @returns {SupportedShell}
 */
const getShellFromEnv = env => {
  if (!env.SHELL) {
    throw new TypeError('SHELL cannot be empty');
  }
  // some shell env (such as mingw64) would change SHELL into an absolute path even if it was manually set to just a name
  const shell = path.basename(env.SHELL)
  if (!isShellSupported(shell)) {
    const supportedValues = SUPPORTED_SHELLS.map(x => `'${x}'`).join(', ');
    throw new TypeError(`SHELL was set to an invalid value (${env.SHELL}). Supported values are: ${supportedValues}`);
  }
  return shell;
}

/**
 * Construct a completion script.
 * @param {Object} options - Options object.
 * @param {String} options.name - The package configured for completion
 * @param {String} options.completer - The program the will act as the completer for the `name` program
 * @param {SupportedShell} options.shell
 * @returns {Promise.<String>}
 */
const getCompletionScript = async ({ name, completer, shell }) => {
  if (!name) throw new TypeError('options.name is required');
  if (!completer) throw new TypeError('options.completer is required');
  if (!shell) throw new TypeError('options.shell is required');
  const completionScriptContent = await installer.getCompletionScript({ name, completer, shell });
  return completionScriptContent
}

/**
 * Install and enable completion on user system.
 *
 * @param {Object} options
 * @param {String} options.name - Name of the program whose completion needs to be installed.
 * @param {String} options.completer - Name of the program that provides completion service.
 * @param {SupportedShell} [options.shell] - Name of the target shell. If not specified, it'll prompt the user.
 */
const install = async (options) => {
  const { name, completer } = options;
  if (!name) throw new TypeError('options.name is required');
  if (!completer) throw new TypeError('options.completer is required');

  if (options.shell) {
    const location = SHELL_LOCATIONS[options.shell];
    if (!location) {
      throw new Error(`Couldn't find shell location for ${options.shell}`);
    }
    await installer.install({
      name,
      completer,
      location,
      shell: options.shell
    });
    return;
  }

  const { location, shell } = await prompt();

  await installer.install({
    name,
    completer,
    location,
    shell
  });
};

/**
 * Uninstall shell completion for one program from one or all supported shells.
 *
 * It also removes the relevant scripts if no more completion are installed on
 * the system.
 *
 * @param {Object} options
 * @param {String} options.name - Name of the target program.
 * @param {SupportedShell} [options.shell] - The target shell language. If not specified, target all supported shells.
 */
const uninstall = async options => {
  const { name, shell } = options;
  if (!name) throw new TypeError('options.name is required');

  try {
    await installer.uninstall({ name, shell });
  } catch (err) {
    console.error('ERROR while uninstalling', err);
  }
};

/**
 * @typedef {Object} ParseEnvResult
 * @property {Boolean} complete   Whether we act in "plumbing mode" or not
 * @property {Number} words       Number of words in the completed line
 * @property {Number} point       Cursor position
 * @property {String} line        Input line
 * @property {String} partial     Part of line preceding cursor position
 * @property {String} last        The last word of the line
 * @property {String} lastPartial The last word of partial
 * @property {String} prev        The word preceding last
 */

/**
 * Main utility to extract information from command line arguments and
 * Environment variables, namely COMP args in "plumbing" mode.
 *
 * @param {Record.<String, String | undefined>} env - The environment Object that holds COMP args (usually `process.env`).
 *
 * @returns {ParseEnvResult} Extracted information.
 */
const parseEnv = env => {
  if (!env) {
    throw new Error('parseEnv: You must pass in an environment object.');
  }

  debug(
    'Parsing env. CWORD: %s, COMP_POINT: %s, COMP_LINE: %s',
    env.COMP_CWORD,
    env.COMP_POINT,
    env.COMP_LINE
  );

  let cword = Number(env.COMP_CWORD);
  let point = Number(env.COMP_POINT);
  const line = env.COMP_LINE || '';

  if (Number.isNaN(cword)) cword = 0;
  if (Number.isNaN(point)) point = 0;

  const partial = line.slice(0, point);

  const parts = line.split(' ');
  const prev = parts.slice(0, -1).slice(-1)[0];

  const last = parts.slice(-1).join('');
  const lastPartial = partial
    .split(' ')
    .slice(-1)
    .join('');

  let complete = true;
  if (!env.COMP_CWORD || !env.COMP_POINT || !env.COMP_LINE) {
    complete = false;
  }

  return {
    complete,
    words: cword,
    point,
    line,
    partial,
    last,
    lastPartial,
    prev
  };
};

/**
 * @typedef {Object} CompletionItem
 * @property {String} name
 * @property {String} [description]
 */

/**
 * Helper to normalize String and Objects with { name, description } when logging out.
 *
 * @param {String | CompletionItem} item - Item to normalize
 * @param {SupportedShell} shell
 * @returns {CompletionItem} normalized items
 */
const completionItem = (item, shell) => {
  debug('completion item', item);

  if (typeof item === 'object') return item

  let name = item;
  let description = '';
  const matching = /^(.*?)(\\)?:(.*)$/.exec(item);
  if (matching) {
    [, name, , description] = matching;
  }

  if (shell === 'zsh' && /\\/.test(item)) {
    name += '\\';
  }

  return {
    name,
    description
  };
};

/**
 * Main logging utility to pass completion items.
 *
 * This is simply an helper to log to stdout with each item separated by a new
 * line.
 *
 * Bash needs in addition to filter out the args for the completion to work
 * (zsh, fish don't need this).
 *
 * @param {Array.<CompletionItem | String>} args - to log, Strings or Objects with name and
 * description property.
 * @param {SupportedShell} shell
 * @param {(message: String) => void} logToConsole - Function to actually log to the console, usually `console.log`
 */
const log = (args, shell, logToConsole = console.log) => {
  if (!Array.isArray(args)) {
    throw new Error('log: Invalid arguments, must be an array');
  }

  // Normalize arguments if there are some Objects { name, description } in them.
  let lines = args.map(item => completionItem(item, shell)).map(item => {
    const { name: rawName, description: rawDescription } = item;

    const name = shell === 'zsh' ? rawName?.replaceAll(':', '\\:') : rawName;
    const description =
      shell === 'zsh' ? rawDescription?.replaceAll(':', '\\:') : rawDescription;
    let str = name;

    if (shell === 'zsh' && description) {
      str = `${name}:${description}`;
    } else if ((shell === 'fish' || shell === 'pwsh') && description) {
      str = `${name}\t${description}`;
    }

    return str;
  });

  if (shell === 'bash') {
    const env = parseEnv(process.env);
    lines = lines.filter(arg => arg.indexOf(env.last) === 0);
  }

  for (const line of lines) {
    logToConsole(`${line}`);
  }
};

/**
 * Logging utility to trigger the filesystem autocomplete.
 *
 * This function just returns a constant string that is then interpreted by the
 * completion scripts as an instruction to trigger the built-in filesystem
 * completion.
 */
const logFiles = () => {
  console.log('__tabtab_complete_files__');
};

module.exports = {
  SUPPORTED_SHELLS,
  getShellFromEnv,
  isShellSupported,
  getCompletionScript,
  install,
  uninstall,
  parseEnv,
  log,
  logFiles
};
