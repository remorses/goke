const fs = require('fs');
const path = require('path');
const untildify = require('untildify');
const { promisify } = require('util');
const { tabtabDebug, exists } = require('./utils');
const { SUPPORTED_SHELLS } = require('./constants')

const debug = tabtabDebug('tabtab:installer');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

const {
  SHELL_LOCATIONS,
  COMPLETION_DIR,
} = require('./constants');

const {
  templateFileName,
  completionFileName,
  tabtabFileName,
} = require('./filename');

/**
 * @typedef {import('./constants').SupportedShell} SupportedShell
 */

/**
 * Helper to return the correct script template based on the SHELL provided
 *
 * @param {SupportedShell} shell - Shell to base the check on, defaults to system shell.
 * @returns {String} The template script content, defaults to Bash for shell we don't know yet
 */
const scriptFromShell = shell => path.join(__dirname, 'templates', templateFileName(shell));

/**
 * Helper to return the expected location for SHELL config file, based on the
 * provided shell value.
 *
 * @param {SupportedShell} shell - Shell value to test against
 * @returns {String} Either ~/.bashrc, ~/.zshrc or ~/.config/fish/config.fish,
 * untildified. Defaults to ~/.bashrc if provided SHELL is not valid.
 */
const locationFromShell = shell => {
  const location = SHELL_LOCATIONS[shell];
  if (!location) {
    throw new Error(`Unsupported shell: ${shell}`);
  }
  return untildify(location);
};

/**
 * Helper to return the source line to add depending on the SHELL provided or detected.
 *
 * If the provided SHELL is not known, it returns the source line for a Bash shell.
 *
 * @param {String} scriptname - The script to source
 * @param {SupportedShell} shell - Shell to base the check on
 */
const sourceLineForShell = (scriptname, shell) => {
  // Windows naturally uses `\` as path separator, which would be misinterpreted by the
  // shell interpreters.
  scriptname = scriptname.replaceAll('\\', '/');

  if (shell === 'fish') {
    return `[ -f ${scriptname} ]; and . ${scriptname}; or true`;
  }

  if (shell === 'zsh') {
    return `[[ -f ${scriptname} ]] && . ${scriptname} || true`;
  }

  if (shell === 'pwsh') {
    return `if (Test-Path ${scriptname}) { . ${scriptname} }`;
  }

  if (shell === 'bash') {
    return `[ -f ${scriptname} ] && . ${scriptname} || true`;
  }

  throw new Error(`Unsupported shell: ${shell}`);
};

/**
 * Helper to check if a filename is one of the SHELL config we expect
 *
 * @param {String} filename - Filename to check against
 * @returns {Boolean} Either true or false
 */
const isInShellConfig = filename =>
  [
    SHELL_LOCATIONS.bash,
    SHELL_LOCATIONS.zsh,
    SHELL_LOCATIONS.fish,
    SHELL_LOCATIONS.pwsh,
    untildify(SHELL_LOCATIONS.bash),
    untildify(SHELL_LOCATIONS.zsh),
    untildify(SHELL_LOCATIONS.fish),
    untildify(SHELL_LOCATIONS.pwsh),
  ].includes(filename);

/**
 * Checks a given file for the existence of a specific line. Used to prevent
 * adding multiple completion source to SHELL scripts.
 *
 * @param {String} filename - The filename to check against
 * @param {String} line     - The line to look for
 * @returns {Promise.<Boolean>} true or false, false if the line is not present.
 */
const checkFilenameForLine = async (filename, line) => {
  debug('Check filename (%s) for "%s"', filename, line);

  let filecontent = '';
  try {
    filecontent = await readFile(untildify(filename), 'utf8');
  } catch (/** @type {any} */ err) {
    if (err.code !== 'ENOENT') {
      console.error(
        'Got an error while trying to read from %s file',
        filename,
        err
      );
      return false;
    }
  }

  return !!filecontent.match(`${line}`);
};

/**
 * Opens a file for modification adding a new `source` line for the given
 * SHELL. Used for both SHELL script and tabtab internal one.
 *
 * @param {Object} options - Options.
 * @param {String} options.filename - The file to modify.
 * @param {String} options.scriptname - The line to add sourcing this file.
 * @param {String} options.name - The package being configured.
 * @param {SupportedShell} options.shell
 * @returns {Promise.<void>}
 */
const writeLineToFilename = ({ filename, scriptname, name, shell }) => new Promise((
  resolve,
  reject
) => {
  const filepath = untildify(filename);

  debug('Creating directory for %s file', filepath);
  mkdir(path.dirname(filepath), { recursive: true })
    .then(() => {
      const stream = fs.createWriteStream(filepath, { flags: 'a' });
      stream.on('error', reject);
      stream.on('finish', () => resolve());

      debug('Writing to shell configuration file (%s)', filename);
      debug('scriptname:', scriptname);

      const inShellConfig = isInShellConfig(filename);
      if (inShellConfig) {
        stream.write(`\n# tabtab source for packages`);
      } else {
        stream.write(`\n# tabtab source for ${name} package`);
      }

      stream.write('\n# uninstall by removing these lines');
      stream.write(`\n${sourceLineForShell(scriptname, shell)}`);
      stream.end('\n');

      console.log('=> Added tabtab source line in "%s" file', filename);
    })
    .catch(err => {
      console.error('mkdirp ERROR', err);
      reject(err);
    });
});

/**
 * Writes to SHELL config file adding a new line, but only one, to the SHELL
 * config script. This enables tabtab to work for the given SHELL.
 *
 * @param {Object} options - Options object with
 * @param {String} options.location - The SHELL script location (~/.bashrc, ~/.zshrc or
 *    ~/.config/fish/config.fish)
 * @param {String} options.name - The package configured for completion
 * @param {SupportedShell} options.shell options.shell
 */
const writeToShellConfig = async ({ location, name, shell }) => {
  const scriptname = path.join(
    COMPLETION_DIR,
    shell,
    tabtabFileName(shell),
  );

  const filename = location;

  // Check if SHELL script already has a line for tabtab
  const existing = await checkFilenameForLine(filename, scriptname);
  if (existing) {
    return console.log('=> Tabtab line already exists in %s file', filename);
  }

  return writeLineToFilename({
    filename,
    scriptname,
    name,
    shell,
  });
};

/**
 * Writes to tabtab internal script that acts as a frontend router for the
 * completion mechanism, in the internal ~/.config/tabtab directory. Every
 * completion is added to this file.
 *
 * @param {Object} options - Options object with
 * @param {String} options.name - The package configured for completion
 * @param {SupportedShell} options.shell
 */
const writeToTabtabScript = async ({ name, shell }) => {
  const filename = path.join(
    COMPLETION_DIR,
    shell,
    tabtabFileName(shell),
  );

  const scriptname = path.join(
    COMPLETION_DIR,
    shell,
    completionFileName(name, shell),
  );

  // Check if tabtab completion file already has this line in it
  const existing = await checkFilenameForLine(filename, scriptname);
  if (existing) {
    return console.log('=> Tabtab line already exists in %s file', filename);
  }

  return writeLineToFilename({ filename, scriptname, name, shell });
};

/**
 * Construct a completion script
 * @param {Object} options - Options object
 * @param {String} options.name - The package configured for completion
 * @param {String} options.completer - The program the will act as the completer for the `name` program
 * @param {SupportedShell} options.shell
 * @returns {Promise.<String>}
 */
const getCompletionScript = async ({ name, completer, shell }) => {
  const templatePath = scriptFromShell(shell);
  const templateContent = await readFile(templatePath, 'utf8');
  const scriptContent = templateContent
    .replaceAll('{pkgname}', name)
    .replaceAll('{completer}', completer)
    // on Bash on windows, we need to make sure to remove any \r
    .replaceAll(/\r?\n/g, '\n');
  return scriptContent
};

/**
 * This writes a new completion script in the internal `~/.config/tabtab`
 * directory. Depending on the SHELL used, a different script is created for
 * the given SHELL.
 *
 * @param {Object} options - Options object with
 * @param {String} options.name - The package configured for completion
 * @param {String} options.completer - The binary that will act as the completer for `name` program
 * @param {SupportedShell} options.shell
 */
const writeToCompletionScript = async ({ name, completer, shell }) => {
  const filename = untildify(
    path.join(COMPLETION_DIR, shell, completionFileName(name, shell))
  );

  try {
    const filecontent = await getCompletionScript({ name, completer, shell })
    debug('Writing completion script to', filename);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, filecontent);
    console.log('=> Wrote completion script to %s file', filename);
  } catch (err) {
    console.error('ERROR:', err);
  }
};

/**
 * Top level install method. Does three things:
 *
 * - Writes to SHELL config file, adding a new line to tabtab internal script.
 * - Creates or edit tabtab internal script
 * - Creates the actual completion script for this package.
 *
 * @param {Object} options - Options object with
 * @param {String} options.name - The program name to complete
 * @param {String} options.completer - The actual program or binary that will act as the completer
 *    for `name` program. Can be the same.
 * @param {String} options.location - The SHELL script config location (~/.bashrc, ~/.zshrc or
 *    ~/.config/fish/config.fish)
 * @param {SupportedShell} options.shell - the target shell language
 */
const install = async options => {
  debug('Install with options', options);
  if (!options) {
    throw new Error('options is required');
  }

  if (!options.name) {
    throw new Error('options.name is required');
  }

  if (!options.completer) {
    throw new Error('options.completer is required');
  }

  if (!options.location) {
    throw new Error('options.location is required');
  }

  await Promise.all([
    writeToShellConfig(options),
    writeToTabtabScript(options),
    writeToCompletionScript(options)
  ]);
  const { location, name } = options;
  console.log(`
    => Tabtab source line added to ${location} for ${name} package.

    Make sure to reload your SHELL.
  `);
};

/**
 * Removes the 3 relevant lines from provided filename, based on the package
 * name passed in.
 *
 * @param {String} filename - The filename to operate on
 * @param {String} name - The package name to look for
 */
const removeLinesFromFilename = async (filename, name) => {
  /* eslint-disable no-unused-vars */
  debug('Removing lines from %s file, looking for %s package', filename, name);
  if (!(await exists(filename))) {
    return debug('File %s does not exist', filename);
  }

  const filecontent = await readFile(filename, 'utf8');
  const lines = filecontent.split(/\r?\n/);

  const sourceLine1 = `# tabtab source for packages`;
  const sourceLine2 = `# tabtab source for ${name} package`;

  const hasLine1 = filecontent.includes(sourceLine1);
  if (!hasLine1) {
    debug('File %s does not include the line: %s', filename, sourceLine1);
  }
  const hasLine2 = filecontent.includes(sourceLine2);
  if (!hasLine2) {
    debug('File %s does not include the line: %s', filename, sourceLine2);
  }
  const hasLine = hasLine1 || hasLine2;
  if (!hasLine) {
    return debug('File %s does not include either line', filename);
  }

  let lineIndex = -1;
  const buffer = lines
    // Build up the new buffer, removing the 3 lines following the sourceline
    .map((line, index) => {
      const match = line.match(sourceLine1) ?? line.match(sourceLine2);
      if (match) {
        lineIndex = index;
      } else if (lineIndex + 3 <= index) {
        lineIndex = -1;
      }

      return lineIndex === -1 ? line : '';
    })
    // Remove any double empty lines from this file
    .map((line, index, array) => {
      const next = array[index + 1];
      if (line === '' && next === '') {
        return;
      }

      return line;
    })
    // Remove any undefined value from there
    .filter(line => line !== undefined)
    .join('\n')
    .trim();

  await writeFile(filename, buffer);
  console.log('=> Removed tabtab source lines from %s file', filename);
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
  debug('Uninstall with options', options);
  if (!options) {
    throw new Error('options is required');
  }

  const { name, shell } = options;

  if (!name) {
    throw new Error('Unable to uninstall if options.name is missing');
  }

  if (!shell) {
    await Promise.all(SUPPORTED_SHELLS.map(shell => uninstall({ name, shell })));
    return;
  }

  const completionScript = untildify(
    path.join(COMPLETION_DIR, shell, completionFileName(name, shell))
  );

  // First, lets remove the completion script itself
  if (await exists(completionScript)) {
    await unlink(completionScript);
    console.log('=> Removed completion script (%s)', completionScript);
  }

  // Then the lines in ~/.config/tabtab/__tabtab.shell
  const tabtabScript = untildify(
    path.join(
      COMPLETION_DIR,
      shell,
      tabtabFileName(shell),
    )
  );
  await removeLinesFromFilename(tabtabScript, name);

  // Then, check if __tabtab.shell is empty, if so remove the last source line in SHELL config
  const isEmpty = (await readFile(tabtabScript, 'utf8')).trim() === '';
  if (isEmpty) {
    const shellScript = locationFromShell(shell);
    debug(
      'File %s is empty. Removing source line from %s file',
      tabtabScript,
      shellScript
    );
    await removeLinesFromFilename(shellScript, name);
  }

  console.log('=> Uninstalled completion for %s package', name);
};

module.exports = {
  install,
  uninstall,
  checkFilenameForLine,
  getCompletionScript,
  writeToShellConfig,
  writeToTabtabScript,
  writeToCompletionScript,
  writeLineToFilename
};
