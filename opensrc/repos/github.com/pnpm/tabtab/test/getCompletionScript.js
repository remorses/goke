const assert = require('assert');
const fs = require('fs');
const { getCompletionScript, SUPPORTED_SHELLS } = require('..');
const { COMPLETION_FILE_EXT } = require('../lib/constants');

describe('getCompletionScript gets the right completion script for', () => {
  for (const shell of SUPPORTED_SHELLS) {
    it(shell, async () => {
      const received = await getCompletionScript({
        name: 'foo',
        completer: 'foo-complete',
        shell
      });
      const expected = fs.readFileSync(require.resolve(`../lib/templates/completion.${COMPLETION_FILE_EXT[shell]}`), 'utf8')
        .replaceAll('{pkgname}', 'foo')
        .replaceAll('{completer}', 'foo-complete')
        .replaceAll(/\r?\n/g, '\n');
      assert.equal(received, expected);
    });
  }
});
