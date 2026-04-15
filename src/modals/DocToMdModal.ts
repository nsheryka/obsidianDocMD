import { App, Modal, Setting, TFile, TFolder, Notice, normalizePath } from 'obsidian';
import type DocMDPlugin from '../main';
import { parseDocId } from '../google/drive';
import { getDocument } from '../google/docs';
import { docToMarkdown, stripYamlFrontmatter } from '../converters/docToMarkdown';
import { downloadImagesInMarkdown } from '../converters/images';
import { convertDocWithLinks } from '../converters/linkedDocs';
import { ProgressModal } from './ProgressModal';
import { FolderPickerModal } from './FolderPickerModal';
import { ConflictModal } from './ConflictModal';

export class DocToMdModal extends Modal {
  private plugin: DocMDPlugin;
  private urlInput: HTMLTextAreaElement;
  private selectedFolder: TFolder | null;
  private folderDisplay: HTMLElement;
  private recursiveToggle: boolean;
  private frontmatterToggle: boolean;
  private presetFolder: TFolder | null;

  constructor(app: App, plugin: DocMDPlugin, presetFolder?: TFolder) {
    super(app);
    this.plugin = plugin;
    this.selectedFolder = presetFolder || null;
    this.presetFolder = presetFolder || null;
    this.recursiveToggle = plugin.settings.defaultRecursive;
    // Frontmatter defaults to ON when the feature is enabled
    this.frontmatterToggle = plugin.settings.enableFrontmatter;
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText('Import Google Doc to Markdown');
    contentEl.addClass('docmd-modal');

    // URL input
    new Setting(contentEl)
      .setName('Google Doc URL(s)')
      .setDesc('One URL per line')
      .addTextArea(text => {
        this.urlInput = text.inputEl;
        text.setPlaceholder('https://docs.google.com/document/d/...');
        text.inputEl.rows = 4;
        text.inputEl.style.width = '100%';
      });

    // Folder picker
    const folderSetting = new Setting(contentEl)
      .setName('Output folder')
      .addButton(btn => btn
        .setButtonText('Choose folder')
        .onClick(() => {
          new FolderPickerModal(this.app, (folder) => {
            this.selectedFolder = folder;
            this.folderDisplay.setText(folder.path || '/');
          }).open();
        }));
    this.folderDisplay = folderSetting.descEl;
    this.folderDisplay.setText(this.selectedFolder?.path || 'No folder selected');

    // Recursive toggle
    new Setting(contentEl)
      .setName('Follow links recursively')
      .setDesc('Also convert linked documents')
      .addToggle(toggle => toggle
        .setValue(this.recursiveToggle)
        .onChange(value => { this.recursiveToggle = value; }));

    // Frontmatter toggle (only shown when feature is enabled in settings)
    if (this.plugin.settings.enableFrontmatter) {
      new Setting(contentEl)
        .setName('Add frontmatter')
        .setDesc('Insert YAML frontmatter as configured in settings')
        .addToggle(toggle => toggle
          .setValue(this.frontmatterToggle)
          .onChange(value => { this.frontmatterToggle = value; }));
    }

    // Convert button
    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Convert')
        .setCta()
        .onClick(() => this.doConvert()));
  }

  private async doConvert(): Promise<void> {
    const rawUrls = this.urlInput.value.trim();
    if (!rawUrls) {
      new Notice('DocMD: Enter at least one Google Doc URL.');
      return;
    }
    if (!this.selectedFolder) {
      new Notice('DocMD: Select an output folder.');
      return;
    }

    const urls = rawUrls.split('\n').map(u => u.trim()).filter(Boolean);
    this.close();

    const progress = new ProgressModal(this.app, 'Importing Google Docs');
    progress.open();

    try {
      const token = await this.plugin.authManager.getAccessToken();

      if (this.recursiveToggle) {
        await this.doConvertRecursive(token, urls, progress);
      } else {
        await this.doConvertSingle(token, urls, progress);
      }
    } catch (err) {
      progress.showError(`Auth error: ${(err as Error).message}`);
    }
  }

  private async doConvertRecursive(token: string, urls: string[], progress: ProgressModal): Promise<void> {
    const folderPath = this.selectedFolder!.path;

    const checkConflict = async (filePath: string, newContent: string) => {
      const existing = this.app.vault.getAbstractFileByPath(filePath);
      if (!existing || !(existing instanceof TFile)) {
        return { action: 'overwrite' };
      }
      const existingContent = await this.app.vault.read(existing);
      const existingBody = stripYamlFrontmatter(existingContent);
      const newBody = stripYamlFrontmatter(newContent);
      if (existingBody === newBody) {
        return { action: 'overwrite' };
      }
      const conflict = new ConflictModal(this.app, filePath, existingBody, newBody);
      return conflict.waitForResolution();
    };

    const { files, errors } = await convertDocWithLinks(
      this.app,
      token,
      urls,
      folderPath,
      (msg) => progress.log(msg),
      checkConflict,
      {
        frontmatter: this.frontmatterToggle,
        frontmatterTemplate: this.plugin.settings.frontmatterFields,
      }
    );

    for (const err of errors) {
      progress.log(`Error (${err.url}): ${err.error}`, 'error');
    }

    progress.finish(`Done! Converted ${files.length} document(s)${errors.length > 0 ? `, ${errors.length} error(s)` : ''}.`);
  }

  private async doConvertSingle(token: string, urls: string[], progress: ProgressModal): Promise<void> {
    let converted = 0;
    const folderPath = this.selectedFolder!.path;

    for (const url of urls) {
      try {
        const docId = parseDocId(url);
        progress.log(`Fetching document...`);
        const doc = await getDocument(token, docId);
        const title = doc.title || 'Untitled';
        progress.log(`Converting "${title}"...`);

        let markdown = docToMarkdown(doc, {
          sourceUrl: url,
          frontmatter: this.frontmatterToggle,
          frontmatterTemplate: this.plugin.settings.frontmatterFields,
        });

        const safeTitle = title
          .replace(/[/\\?%*:|"<>]/g, '-')
          .replace(/\s+/g, ' ')
          .trim();
        let notePath = normalizePath(
          folderPath ? `${folderPath}/${safeTitle}.md` : `${safeTitle}.md`
        );

        progress.log('Downloading images...');
        markdown = await downloadImagesInMarkdown(this.app, markdown, notePath, `${safeTitle}-`);

        const existing = this.app.vault.getAbstractFileByPath(notePath);
        if (existing && existing instanceof TFile) {
          const existingContent = await this.app.vault.read(existing);
          const existingBody = stripYamlFrontmatter(existingContent);
          const newBody = stripYamlFrontmatter(markdown);
          if (existingBody !== newBody) {
            progress.log(`File exists, waiting for resolution: ${notePath}`);
            const conflict = new ConflictModal(this.app, notePath, existingBody, newBody);
            const resolution = await conflict.waitForResolution();

            if (resolution.action === 'cancel') {
              progress.log(`Skipped: ${notePath}`);
              continue;
            }
            if (resolution.action === 'rename' && resolution.newFilename) {
              notePath = normalizePath(
                folderPath ? `${folderPath}/${resolution.newFilename}.md` : `${resolution.newFilename}.md`
              );
            }
          }
        }

        const target = this.app.vault.getAbstractFileByPath(notePath);
        if (target && target instanceof TFile) {
          await this.app.vault.modify(target, markdown);
        } else {
          await this.app.vault.create(notePath, markdown);
        }

        converted++;
        progress.log(`Saved: ${notePath}`, 'success');
      } catch (err) {
        progress.log(`Error: ${(err as Error).message}`, 'error');
      }
    }

    progress.finish(`Done! Converted ${converted} of ${urls.length} document(s).`);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
