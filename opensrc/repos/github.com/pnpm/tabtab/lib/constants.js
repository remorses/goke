const COMPLETION_DIR = '~/.config/tabtab';

const SUPPORTED_SHELLS = /** @type {const} */ (['bash', 'fish', 'pwsh', 'zsh']);

/**
 * @typedef {typeof SUPPORTED_SHELLS[number]} SupportedShell
 */

/** @satisfies {Record.<SupportedShell, String>} */
const SHELL_LOCATIONS = /** @type {const} */ ({
  bash: '~/.bashrc',
  zsh: '~/.zshrc',
  fish: '~/.config/fish/config.fish',
  pwsh: '~/Documents/PowerShell/Microsoft.PowerShell_profile.ps1'
});

/** @satisfies {Record.<SupportedShell, String>} */
const COMPLETION_FILE_EXT = /** @type {const} */ ({
  bash: 'bash',
  fish: 'fish',
  pwsh: 'ps1',
  zsh: 'zsh',
});

module.exports = {
  COMPLETION_DIR,
  SUPPORTED_SHELLS,
  SHELL_LOCATIONS,
  COMPLETION_FILE_EXT,
};
