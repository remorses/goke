const enquirer = require('enquirer');
const path = require('path');
const { SUPPORTED_SHELLS, SHELL_LOCATIONS } = require('./constants');
const debug = require('./utils/tabtabDebug')('tabtab:prompt');

/**
 * @typedef {import('./constants').SupportedShell} SupportedShell
 */

/**
 * @typedef {Object} PromptAnswer
 * @property {SupportedShell} shell
 * @property {String} location
 */

/**
 * Asks user about SHELL and desired location.
 *
 * It is too difficult to check spawned SHELL, the user has to use chsh before
 * it is reflected in process.env.SHELL
 *
 * @returns {Promise.<PromptAnswer>}
 */
const prompt = async () => {
  const questions = [
    {
      type: 'select',
      name: 'shell',
      message: 'Which Shell do you use ?',
      choices: SUPPORTED_SHELLS,
      default: 'bash'
    }
  ];

  const { shell } = /** @type {{ shell: SupportedShell }} */ (await enquirer.prompt(questions));
  debug('answers', shell);

  if (!(shell in SHELL_LOCATIONS)) {
    throw new Error(`Unsupported shell: ${shell}`);
  }

  const location = SHELL_LOCATIONS[/** @type {SupportedShell} */ (shell)];
  debug(`Will install completion to ${location}`);

  const initialAnswer = { location, shell };

  const { locationOK } = /** @type {{ locationOK: Boolean }} */ (await enquirer.prompt({
    type: 'confirm',
    name: 'locationOK',
    message: `We will install completion to ${location}, is it ok ?`
  }));

  if (locationOK) {
    debug('location is ok, return', initialAnswer);
    return initialAnswer;
  }

  // otherwise, ask for specific **absolute** path
  const { userLocation } = /** @type {{ userLocation: String }} */ (await enquirer.prompt({
    name: 'userLocation',
    message: 'Which path then ? Must be absolute.',
    type: 'input',
    validate: input => {
      debug('Validating input', input);
      return path.isAbsolute(input);
    }
  }));
  console.log(`Very well, we will install using ${userLocation}`);

  return { shell, location: userLocation };
};

module.exports = prompt;
