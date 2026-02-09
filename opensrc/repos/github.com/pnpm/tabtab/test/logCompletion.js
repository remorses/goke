const assert = require('assert');
const tabtab = require('..');

describe('tabtab.log', () => {
  it('tabtab.log throws an Error in case args is not an Array', () => {
    assert.throws(() => {
      // @ts-ignore
      tabtab.log('foo', 'bar');
    }, /^Error: log: Invalid arguments, must be an array$/);
  });

  const logTestHelper = (items, shell) => {
    const logs = [];
    const log = message => {
      logs.push(message);
    }
    tabtab.log(items, shell, log);
    return logs;
  };

  it('tabtab.log logs item to the console', () => {
    assert.equal(typeof tabtab.log, 'function');

    const logs = logTestHelper(['--foo', '--bar'], 'bash');

    assert.equal(logs.length, 2);
    assert.deepStrictEqual(logs, ['--foo', '--bar']);
  });

  it('tabtab.log accepts { name, description }', () => {
    const logs = logTestHelper([
      { name: '--foo', description: 'Foo options' },
      { name: '--bar', description: 'Bar options' }
    ], 'zsh');

    assert.deepStrictEqual(logs, [
      '--foo:Foo options',
      '--bar:Bar options',
    ]);
  });

  it('tabtab.log normalize String and Objects', () => {
    const logs = logTestHelper([
      { name: '--foo', description: 'Foo options' },
      { name: '--bar', description: 'Bar options' },
      'foobar'
    ], 'zsh');

    assert.deepStrictEqual(logs, [
      '--foo:Foo options',
      '--bar:Bar options',
      'foobar',
    ]);
  });

  it('tabtab.log normalize String and Objects, with description stripped out on Bash', () => {
    const logs = logTestHelper([
      { name: '--foo', description: 'Foo options' },
      { name: '--bar', description: 'Bar option' },
      'foobar',
      'barfoo:barfoo is not foobar'
    ], 'bash');

    assert.equal(logs.length, 4);
    assert.deepStrictEqual(logs, ['--foo', '--bar', 'foobar', 'barfoo']);
  });

  it('tabtab.log with description NOT stripped out on Zsh', () => {
    const logs = logTestHelper([
      { name: '--foo', description: 'Foo option' },
      { name: '--bar', description: 'Bar option' },
      'foobar',
      'barfoo:barfoo is not foobar'
    ], 'zsh');

    assert.equal(logs.length, 4);
    assert.deepStrictEqual(logs, [
      '--foo:Foo option',
      '--bar:Bar option',
      'foobar',
      'barfoo:barfoo is not foobar'
    ]);
  });

  it('tabtab.log with description NOT stripped out on fish', () => {
    const logs = logTestHelper([
      { name: '--foo', description: 'Foo option' },
      { name: '--bar', description: 'Bar option' },
      'foobar',
      'barfoo:barfoo is not foobar'
    ], 'fish');

    assert.equal(logs.length, 4);
    assert.deepStrictEqual(logs, [
      '--foo\tFoo option',
      '--bar\tBar option',
      'foobar',
      'barfoo\tbarfoo is not foobar'
    ]);
  });

  it('tabtab.log could use {name, description} for completions with ":" in them', () => {
    const logs = logTestHelper([
      { name: '--foo:bar', description: 'Foo option' },
      { name: '--bar:foo', description: 'Bar option' },
      'foobar',
      'barfoo:barfoo is not foobar'
    ], 'zsh');

    assert.equal(logs.length, 4);
    assert.deepStrictEqual(logs, [
      '--foo\\:bar:Foo option',
      '--bar\\:foo:Bar option',
      'foobar',
      'barfoo:barfoo is not foobar'
    ]);
  });

  it('tabtab.log should escape ":" when name is given as an object without description', () => {
    const logs = logTestHelper([
      'foo:bar',
      { name: 'foo:bar' },
      { name: 'foo:bar', description: 'A command' },
      { name: 'foo:bar', description: 'The foo:bar command' }
    ], 'zsh');

    assert.deepStrictEqual(logs, [
      'foo:bar',
      'foo\\:bar',
      'foo\\:bar:A command',
      'foo\\:bar:The foo\\:bar command'
    ]);
  });
});
