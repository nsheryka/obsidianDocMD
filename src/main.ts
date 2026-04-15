import { Plugin, Notice, TFile, TFolder } from 'obsidian';
import { DocMDSettings, DocMDSettingTab, DEFAULT_SETTINGS } from './settings';
import { AuthManager } from './auth';
import { DocToMdModal } from './modals/DocToMdModal';
import { MdToDocModal } from './modals/MdToDocModal';

export default class DocMDPlugin extends Plugin {
  settings: DocMDSettings;
  authManager: AuthManager;
  private ribbonIcons: HTMLElement[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();
    this.authManager = new AuthManager(this);

    this.addSettingTab(new DocMDSettingTab(this.app, this, this.authManager));

    this.addCommand({
      id: 'doc-to-md',
      name: 'Import Google Doc to Markdown',
      callback: () => this.openImportModal(),
    });

    this.addCommand({
      id: 'md-to-doc',
      name: 'Export Markdown to Google Doc',
      callback: () => {
        const activeFile = this.app.workspace.getActiveFile();
        const files = activeFile ? [activeFile] : [];
        this.openExportModal(files);
      },
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!this.settings.enableContextMenu) return;
        if (!this.authManager.isAuthenticated()) return;

        if (file instanceof TFile && file.extension === 'md') {
          menu.addItem(item => {
            item.setTitle('Export to Google Doc')
              .setIcon('upload')
              .onClick(() => this.openExportModal([file]));
          });
        }

        if (file instanceof TFolder) {
          menu.addItem(item => {
            item.setTitle('Import Google Doc here')
              .setIcon('download')
              .onClick(() => this.openImportModal(file));
          });
          menu.addItem(item => {
            item.setTitle('Export folder to Google Docs')
              .setIcon('upload')
              .onClick(() => {
                const mdFiles = this.app.vault.getMarkdownFiles()
                  .filter(f => f.path.startsWith(file.path + '/'));
                if (mdFiles.length === 0) {
                  new Notice('DocMD: No markdown files in this folder.');
                  return;
                }
                this.openExportModal(mdFiles);
              });
          });
        }
      })
    );

    this.refreshRibbon();
  }

  onunload(): void {
    this.authManager.destroy();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private openImportModal(presetFolder?: TFolder): void {
    if (!this.authManager.isAuthenticated()) {
      new Notice('DocMD: Connect your Google account in settings first.');
      return;
    }
    new DocToMdModal(this.app, this, presetFolder).open();
  }

  private openExportModal(files: TFile[]): void {
    if (!this.authManager.isAuthenticated()) {
      new Notice('DocMD: Connect your Google account in settings first.');
      return;
    }
    new MdToDocModal(this.app, this, files).open();
  }

  refreshRibbon(): void {
    for (const icon of this.ribbonIcons) {
      icon.remove();
    }
    this.ribbonIcons = [];

    if (!this.settings.enableRibbon) return;

    this.ribbonIcons.push(
      this.addRibbonIcon('download', 'Import Google Doc to Markdown', () => {
        this.openImportModal();
      })
    );

    this.ribbonIcons.push(
      this.addRibbonIcon('upload', 'Export Markdown to Google Doc', () => {
        const activeFile = this.app.workspace.getActiveFile();
        const files = activeFile ? [activeFile] : [];
        this.openExportModal(files);
      })
    );
  }
}
