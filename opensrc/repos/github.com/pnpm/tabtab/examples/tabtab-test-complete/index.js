#! /usr/bin/env node

const opts = require('minimist')(process.argv.slice(2), {
  string: ['foo', 'bar'],
  boolean: ['help', 'version', 'loglevel']
});

const tabtab = require('../..');

const args = opts._;

const completion = env => {
  const shell = tabtab.getShellFromEnv(env);

  if (!env.complete) return;

  if (env.prev === 'someCommand') {
    return tabtab.log(['is', 'this', 'the', 'real', 'life'], shell, console.log);
  }

  if (env.prev === 'anotherOne') {
    return tabtab.log(['is', 'this', 'just', 'fantasy'], shell, console.log);
  }

  if (env.prev === '--loglevel') {
    return tabtab.log(['error', 'warn', 'info', 'notice', 'verbose'], shell, console.log);
  }

  return tabtab.log([
    '--help',
    '--version',
    '--loglevel',
    'foo',
    'bar',
    'generate-completion',
    'install-completion',
    'uninstall-completion',
    'completion-server',
    'someCommand:someCommand is a some kind of command with a description',
    {
      name: 'someOtherCommand:hey',
      description: 'You must add a description for items with ":" in them'
    },
    'anotherOne'
  ], shell, console.log);
};

const init = async () => {
  const cmd = args[0];

  if (opts.help) {
    return console.log('Output help here');
  }

  if (opts.version) {
    return console.log('Output version here');
  }

  if (opts.loglevel) {
    return console.log('Output version here');
  }

  if (cmd === 'foo') {
    return console.log('foobar');
  }

  if (cmd === 'bar') {
    return console.log('barbar');
  }

  if (cmd === 'someCommand') {
    return console.log('is this the real life ?');
  }

  if (cmd === 'anotherOne') {
    return console.log('is this just fantasy ?');
  }

  if (cmd === 'generate-completion') {
    const shell = args[1];
    if (!shell) {
      console.error('shell argument is required');
      return;
    }
    const completion = await tabtab.getCompletionScript({
      name: 'tabtab-test',
      completer: 'tabtab-test',
      shell,
    });
    console.log(completion);
    return;
  }

  if (cmd === 'install-completion') {
    const shell = args[1];
    if (!tabtab.isShellSupported(shell)) {
      throw new Error(`${shell} is not supported`);
    }

    // Here we install for the program `tabtab-test` (this file), with
    // completer being the same program. Sometimes, you want to complete
    // another program that's where the `completer` option might come handy.
    await tabtab
      .install({
        name: 'tabtab-test',
        completer: 'tabtab-test',
        shell,
      })
      .catch(err => console.error('INSTALL ERROR', err));

    return;
  }

  if (cmd === 'uninstall-completion') {
    // Here we uninstall for the program `tabtab-test` (this file).
    await tabtab
      .uninstall({
        name: 'tabtab-test'
      })
      .catch(err => console.error('UNINSTALL ERROR', err));

    return;
  }

  if (cmd === 'completion-server') {
    const env = tabtab.parseEnv(process.env);
    return completion(env);
  }
};

init();
