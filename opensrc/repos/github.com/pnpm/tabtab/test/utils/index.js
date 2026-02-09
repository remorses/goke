const fs = require('fs');
const path = require('path');
const untildify = require('untildify');
const { promisify } = require('util');
const { COMPLETION_DIR } = require('../../lib/constants');
const { tabtabFileName } = require('../../lib/filename');

const { exists } = require('../../lib/utils');

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

/**
 * Returns both { exists, content }
 *
 * @param {String} filename - The file to check and read
 */
const readIfExists = async filename => {
  /* eslint-disable no-return-await */
  const filepath = untildify(filename);
  const fileExists = await exists(filepath);
  const content = fileExists ? await readFile(filepath, 'utf8') : '';

  return {
    exists: fileExists,
    content
  };
};

const afterWrites = (prevBashrc, prevScript) => async () => {
  const bashrc = untildify('~/.bashrc');
  const tabtabScript = untildify(
    path.join(COMPLETION_DIR, tabtabFileName('bash'))
  );

  await writeFile(bashrc, prevBashrc);
  await writeFile(tabtabScript, prevScript);
};

/** This simply setup a suite with after hook for tabtab.install.
 *
 * Defaults to afterEach, pass in true to make it so that it uses "after"
 * instead.
 *
 * @param {Boolean} shouldUseAfter - True to use after instead of afterEach
 */
const setupSuiteForInstall = async (shouldUseAfter = false) => {
  const files = {};
  const hook = shouldUseAfter ? after : afterEach;
  const tabtabScript = path.join(COMPLETION_DIR, tabtabFileName('bash'));

  before(async () => {
    const { exists: bashrcExists, content: bashrcContent } = await readIfExists(
      '~/.bashrc'
    );

    const {
      exists: tabtabScriptExists,
      content: tabtabScriptContent
    } = await readIfExists(tabtabScript);

    files.bashrcExists = bashrcExists;
    files.bashrcContent = bashrcContent;
    files.tabtabScriptExists = tabtabScriptExists;
    files.tabtabScriptContent = tabtabScriptContent;
  });

  hook(async () => {
    const {
      bashrcExists,
      bashrcContent,
      tabtabScriptExists,
      tabtabScriptContent
    } = files;

    if (bashrcExists) {
      await writeFile(untildify('~/.bashrc'), bashrcContent);
    }

    if (tabtabScriptExists) {
      await writeFile(untildify(tabtabScript), tabtabScriptContent);
    }
  });
};

// For node 7 / 8
const rejects = async (promise, error, message = '') => {
  let toThrow;
  await promise().catch(err => {
    if (error instanceof RegExp) {
      const ok = error.test(err.message);
      if (!ok) {
        toThrow = new Error(
          `AssertionError: ${error} is not validated. Got ${err.message}
          ${message}`
        );
      }
    } else {
      const ok = err instanceof error;
      if (!ok) {
        toThrow = new Error(
          `AssertionError: ${err.name} is not an instanceof ${error.name}
          ${message}`
        );
      }
    }
  });

  if (toThrow) {
    throw toThrow;
  }
};

module.exports = {
  readIfExists,
  rejects,
  afterWrites,
  setupSuiteForInstall
};
