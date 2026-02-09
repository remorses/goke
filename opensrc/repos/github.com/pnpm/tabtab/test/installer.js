const assert = require('assert');
const fs = require('fs');
const path = require('path');
const untildify = require('untildify');
const { promisify } = require('util');
const {
  install,
  uninstall,
  writeToShellConfig,
  writeToCompletionScript
} = require('../lib/installer');
const { COMPLETION_DIR } = require('../lib/constants');
const { tabtabFileName } = require('../lib/filename');
const { rejects, setupSuiteForInstall } = require('./utils');

// For node 7 / 8
assert.rejects = rejects;

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

describe('installer', () => {
  it('has install / uninstall functions', () => {
    assert.equal(typeof install, 'function');
    assert.equal(typeof uninstall, 'function');
  });

  it('install rejects on missing options', async () => {
    // @ts-ignore
    await assert.rejects(async () => install(), /options is required/);
    // @ts-ignore
    await assert.rejects(async () => install({}), /options.name is required/);
    await assert.rejects(
      // @ts-ignore
      async () => install({ name: 'foo ' }),
      /options.completer is required/
    );

    await assert.rejects(
      // @ts-ignore
      async () => install({ name: 'foo ', completer: 'foo-complete' }),
      /options.location is required/
    );
  });

  it('uninstall rejects on missing options', async () => {
    await assert.rejects(
      // @ts-ignore
      async () => uninstall(),
      /options is required/,
      'Uninstall should throw the expected message when name is missing'
    );
    await assert.rejects(
      // @ts-ignore
      async () => uninstall({}),
      /Unable to uninstall if options.name is missing/,
      'Uninstall should throw the expected message when name is missing'
    );
  });

  it('has writeToShellConfig / writeToCompletionScript functions', () => {
    assert.equal(typeof writeToShellConfig, 'function');
    assert.equal(typeof writeToCompletionScript, 'function');
  });

  describe('installer on ~/.bashrc', () => {
    setupSuiteForInstall(true);

    before(async () => {
      const bashDir = untildify(path.join(COMPLETION_DIR, 'bash'));
      await mkdir(bashDir, { recursive: true });
      // Make sure __tabtab.bash starts with empty content, it'll be restored by setupSuiteForInstall
      await writeFile(path.join(bashDir, tabtabFileName('bash')), '');
    });

    it('installs the necessary line into ~/.bashrc', () =>
      install({
        name: 'foo',
        completer: 'foo-complete',
        location: '~/.bashrc',
        shell: 'bash'
      })
        .then(() => readFile(untildify('~/.bashrc'), 'utf8'))
        .then(filecontent => {
          assert.ok(/tabtab source for packages/.test(filecontent));
          assert.ok(/uninstall by removing these lines/.test(filecontent));
          assert.ok(
            filecontent.match(
              `. ${path.join(COMPLETION_DIR, 'bash/__tabtab.bash').replaceAll('\\', '/')}`
            )
          );
        })
        .then(() =>
          readFile(
            untildify(path.join(COMPLETION_DIR, 'bash/__tabtab.bash')),
            'utf8'
          )
        )
        .then(filecontent => {
          assert.ok(/tabtab source for foo/.test(filecontent));
          assert.ok(
            filecontent.match(`. ${path.join(COMPLETION_DIR, 'bash/foo.bash').replaceAll('\\', '/')}`)
          );
        }));

    it('uninstalls the necessary line from ~/.bashrc and completion scripts', () =>
      uninstall({
        name: 'foo',
        shell: 'bash'
      })
        .then(() => readFile(untildify('~/.bashrc'), 'utf8'))
        .then(filecontent => {
          assert.ok(!/tabtab source for packages/.test(filecontent));
          assert.ok(!/uninstall by removing these lines/.test(filecontent));
          assert.ok(
            !filecontent.match(
              `. ${path.join(COMPLETION_DIR, 'bash/__tabtab.bash')}`
            )
          );
        })
        .then(() =>
          readFile(
            untildify(path.join(COMPLETION_DIR, 'bash/__tabtab.bash')),
            'utf8'
          )
        )
        .then(filecontent => {
          assert.ok(!/tabtab source for foo/.test(filecontent));
          assert.ok(
            !filecontent.match(
              `. ${path.join(COMPLETION_DIR, 'bash/foo.bash')}`
            )
          );
        }));
  });
});
