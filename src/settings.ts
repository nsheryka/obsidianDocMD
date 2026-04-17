import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type DocMDPlugin from './main';
import type { AuthManager } from './auth';

export interface DocMDTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
}

export interface DocMDSettings {
  clientId: string;
  clientSecret: string;
  tokens: DocMDTokens | null;
  defaultRecursive: boolean;
  enableFrontmatter: boolean;
  frontmatterFields: string;
  enableRibbon: boolean;
  enableContextMenu: boolean;
}

export const DEFAULT_SETTINGS: DocMDSettings = {
  clientId: '',
  clientSecret: '',
  tokens: null,
  defaultRecursive: false,
  enableFrontmatter: false,
  frontmatterFields: 'source: "{sourceUrl}"\nconverted: {date}\ntags:\n  - google-docs-import',
  enableRibbon: true,
  enableContextMenu: true,
};

export class DocMDSettingTab extends PluginSettingTab {
  plugin: DocMDPlugin;
  authManager: AuthManager;

  constructor(app: App, plugin: DocMDPlugin, authManager: AuthManager) {
    super(app, plugin);
    this.plugin = plugin;
    this.authManager = authManager;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- Google API credentials ---
    new Setting(containerEl).setName('Google API credentials').setHeading();

    // Expandable setup instructions
    const detailsEl = containerEl.createEl('details', { cls: 'docmd-setup-instructions' });
    detailsEl.createEl('summary', { text: 'How to get google API credentials' });
    const stepsEl = detailsEl.createEl('ol');
    const steps = [
      'Go to console.cloud.google.com',
      'Create a new project (or select an existing one).',
      'Enable APIs: search for "Google Docs API" and "Google Drive API" and enable both.',
      'Go to APIs & Services \u2192 Credentials \u2192 Create Credentials \u2192 OAuth 2.0 Client IDs.',
      'Choose application type: Desktop app. Give it a name and click Create.',
      'Copy the Client ID and Client Secret shown, and paste them below.',
      'On the OAuth consent screen tab, add your Google account email as a Test user.',
    ];
    for (const step of steps) {
      stepsEl.createEl('li', { text: step });
    }

    new Setting(containerEl)
      .setName('Client ID')
      .setDesc('Client ID from google cloud console')
      .addText(text => text
        .setPlaceholder('Enter client ID')
        .setValue(this.plugin.settings.clientId)
        .onChange(async (value) => {
          this.plugin.settings.clientId = value.trim();
          // Clear tokens when credentials change
          this.plugin.settings.tokens = null;
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(containerEl)
      .setName('Client secret')
      .setDesc('Client secret from google cloud console')
      .addText(text => {
        text
          .setPlaceholder('Enter client secret')
          .setValue(this.plugin.settings.clientSecret)
          .onChange(async (value) => {
            this.plugin.settings.clientSecret = value.trim();
            // Clear tokens when credentials change
            this.plugin.settings.tokens = null;
            await this.plugin.saveSettings();
            this.display();
          });
        // Mask the secret
        text.inputEl.type = 'password';
      });

    // --- Connection Status ---
    const isAuthenticated = this.authManager.isAuthenticated();
    const hasCredentials = this.plugin.settings.clientId && this.plugin.settings.clientSecret;

    if (isAuthenticated) {
      new Setting(containerEl)
        .setName('Google account')
        .setDesc('Connected')
        .addButton(btn => btn
          .setButtonText('Disconnect')
          .setWarning()
          .onClick(async () => {
            this.authManager.disconnect();
            await this.plugin.saveSettings();
            new Notice('Google account disconnected');
            this.display();
          }));
    } else if (hasCredentials) {
      new Setting(containerEl)
        .setName('Google account')
        .setDesc('Not connected')
        .addButton(btn => btn
          .setButtonText('Connect google account')
          .setCta()
          .onClick(async () => {
            try {
              await this.authManager.startOAuthFlow();
              await this.plugin.saveSettings();
              new Notice('Google account connected');
              this.display();
            } catch (e) {
              new Notice(`Auth failed - ${(e as Error).message}`);
            }
          }));
    } else {
      containerEl.createEl('p', {
        text: 'Enter your client ID and client secret above, then connect your google account.',
        cls: 'setting-item-description',
      });
    }

    // --- Defaults ---
    new Setting(containerEl).setName('Defaults').setHeading();

    new Setting(containerEl)
      .setName('Follow links recursively')
      .setDesc('When converting, also convert linked documents by default')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.defaultRecursive)
        .onChange(async (value) => {
          this.plugin.settings.defaultRecursive = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Enable YAML frontmatter on imported notes')
      .setDesc('When enabled, imported google docs will include YAML frontmatter and exports will strip it by default. These options appear in the conversion dialogs.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableFrontmatter)
        .onChange(async (value) => {
          this.plugin.settings.enableFrontmatter = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.enableFrontmatter) {
      const headerSetting = new Setting(containerEl)
        .setName('Frontmatter template')
        .setDesc('YAML fields to include. Use {sourceUrl} for the Google Doc URL and {date} for today\'s date.');

      if (this.plugin.settings.frontmatterFields !== DEFAULT_SETTINGS.frontmatterFields) {
        headerSetting.addButton(btn => btn
          .setButtonText('Reset to default')
          .onClick(async () => {
            this.plugin.settings.frontmatterFields = DEFAULT_SETTINGS.frontmatterFields;
            await this.plugin.saveSettings();
            this.display();
          }));
      }

      const textareaEl = containerEl.createEl('textarea', {
        cls: 'docmd-frontmatter-textarea',
      });
      textareaEl.value = this.plugin.settings.frontmatterFields;
      textareaEl.rows = 5;
      textareaEl.addEventListener('input', () => {
        this.plugin.settings.frontmatterFields = textareaEl.value;
        void this.plugin.saveSettings();
      });
    }

    // --- Interface ---
    new Setting(containerEl).setName('Interface').setHeading();

    new Setting(containerEl)
      .setName('Show ribbon icons')
      .setDesc('Show import/export icons in the left sidebar')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableRibbon)
        .onChange(async (value) => {
          this.plugin.settings.enableRibbon = value;
          await this.plugin.saveSettings();
          this.plugin.refreshRibbon();
        }));

    new Setting(containerEl)
      .setName('Show in context menu')
      .setDesc('Show import/export options when right-clicking files and folders')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableContextMenu)
        .onChange(async (value) => {
          this.plugin.settings.enableContextMenu = value;
          await this.plugin.saveSettings();
        }));
  }
}
