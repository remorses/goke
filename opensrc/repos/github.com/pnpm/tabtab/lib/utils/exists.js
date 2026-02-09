const fs = require('fs');
const untildify = require('untildify');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);

/**
 * @param {String} file
 */
module.exports = async file => {
  let fileExists;
  try {
    await readFile(untildify(file));
    fileExists = true;
  } catch (err) {
    fileExists = false;
  }

  return fileExists;
};
