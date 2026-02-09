const assert = require('assert');
const { isShellSupported, SUPPORTED_SHELLS } = require('..');

describe('isShellSupported', () => {
  it('returns true for supported shells', () => {
    assert.deepStrictEqual(
      SUPPORTED_SHELLS.filter(shell => isShellSupported(shell)),
      SUPPORTED_SHELLS,
    );
  })

  it('returns false for unsupported shells', () => {
    assert.strictEqual(isShellSupported('unknown'), false);
  })
})
