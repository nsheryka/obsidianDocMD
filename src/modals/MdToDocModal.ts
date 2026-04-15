import { App, Modal, Setting, TFile, Notice } from 'obsidian';
import type DocMDPlugin from '../main';
import { parseFolderId } from '../google/drive';
import { createDocument, batchUpdate, getDocument } from '../google/docs';
import { moveFileToFolder, getFileWebLink, getImageContentUri, deleteFile } from '../google/drive';
import { markdownToDocRequests, insertTableIntoDoc } from '../converters/markdownToDoc';
import { stripYamlFrontmatter } from '../converters/docToMarkdown';
import { convertMdWithLinks } from '../converters/linkedDocs';
import { resolveImageInVault, guessMimeType } from '../converters/images';
import { ProgressModal } from './ProgressModal';

export class MdToDocModal extends Modal {
  private plugin: DocMDPlugin;
  private files: TFile[];
  private folderUrlInput: HTMLInputElement;
  private recursiveToggle: boolean;
  private stripFrontmatterToggle: boolean;
  private fileListEl: HTMLElement;

  constructor(app: App, plugin: DocMDPlugin, files?: TFile[]) {
    super(app);
    this.plugin = plugin;
    this.files = files || [];
    this.recursiveToggle = plugin.settings.defaultRecursive;
    // Strip frontmatter defaults to ON when the feature is enabled
    this.stripFrontmatterToggle = plugin.settings.enableFrontmatter;
  }

  onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText('Export Markdown to Google Doc');
    contentEl.addClass('docmd-modal');

    // File list display
    if (this.files.length > 0) {
      const fileSetting = new Setting(contentEl).setName('Files to export');
      this.fileListEl = fileSetting.descEl;
      this.fileListEl.setText(this.files.map(f => f.basename).join(', '));
    } else {
      contentEl.createEl('p', {
        text: 'No files selected. Use the context menu on a .md file or folder to export.',
        cls: 'setting-item-description',
      });
    }

    // Drive folder URL
    new Setting(contentEl)
      .setName('Google Drive folder URL')
      .setDesc('Where to put the created document(s)')
      .addText(text => {
        this.folderUrlInput = text.inputEl;
        text.setPlaceholder('https://drive.google.com/drive/folders/...');
        text.inputEl.style.width = '100%';
      });

    // Recursive toggle
    new Setting(contentEl)
      .setName('Follow links recursively')
      .setDesc('Also convert linked notes')
      .addToggle(toggle => toggle
        .setValue(this.recursiveToggle)
        .onChange(value => { this.recursiveToggle = value; }));

    // Strip frontmatter toggle (only shown when feature is enabled in settings)
    if (this.plugin.settings.enableFrontmatter) {
      new Setting(contentEl)
        .setName('Strip YAML frontmatter')
        .setDesc('Remove YAML frontmatter before uploading to Google Docs')
        .addToggle(toggle => toggle
          .setValue(this.stripFrontmatterToggle)
          .onChange(value => { this.stripFrontmatterToggle = value; }));
    }

    // Convert button
    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Export')
        .setCta()
        .onClick(() => this.doConvert()));
  }

  private async doConvert(): Promise<void> {
    if (this.files.length === 0) {
      new Notice('DocMD: No files to export.');
      return;
    }
    const folderUrl = this.folderUrlInput.value.trim();
    if (!folderUrl) {
      new Notice('DocMD: Enter a Google Drive folder URL.');
      return;
    }

    let folderId: string;
    try {
      folderId = parseFolderId(folderUrl);
    } catch {
      new Notice('DocMD: Invalid Google Drive folder URL.');
      return;
    }

    this.close();

    const progress = new ProgressModal(this.app, 'Exporting to Google Docs');
    progress.open();

    try {
      const token = await this.plugin.authManager.getAccessToken();

      if (this.recursiveToggle) {
        await this.doConvertRecursive(token, folderUrl, progress);
      } else {
        await this.doConvertSingle(token, folderId, progress);
      }
    } catch (err) {
      progress.showError(`Auth error: ${(err as Error).message}`);
    }
  }

  private async doConvertRecursive(token: string, folderUrl: string, progress: ProgressModal): Promise<void> {
    const { files, errors } = await convertMdWithLinks(
      this.app,
      token,
      this.files,
      folderUrl,
      (msg) => progress.log(msg),
      this.stripFrontmatterToggle
    );

    for (const err of errors) {
      progress.log(`Error (${err.path}): ${err.error}`, 'error');
    }

    progress.finish(`Done! Exported ${files.length} document(s)${errors.length > 0 ? `, ${errors.length} error(s)` : ''}.`);
  }

  private async doConvertSingle(token: string, folderId: string, progress: ProgressModal): Promise<void> {
    let converted = 0;

    for (const file of this.files) {
      try {
        progress.log(`Reading "${file.basename}"...`);
        let markdownContent = await this.app.vault.read(file);
        const title = file.basename;

        // Strip YAML frontmatter if enabled
        if (this.stripFrontmatterToggle) {
          markdownContent = stripYamlFrontmatter(markdownContent);
        }

        // Create empty document
        progress.log(`Creating Google Doc "${title}"...`);
        const newDoc = await createDocument(token, title);
        const docId = newDoc.documentId;

        // Generate batchUpdate requests
        const { textRequests, styleRequests, tables, images } = markdownToDocRequests(markdownContent);

        // Pass 1: insert text
        if (textRequests.length > 0) {
          progress.log('Inserting text...');
          await batchUpdate(token, docId, textRequests);
        }

        // Pass 1.5: insert images (reverse order to preserve indices)
        if (images.length > 0) {
          progress.log(`Uploading ${images.length} image(s)...`);
          for (const img of [...images].reverse()) {
            const imageFile = resolveImageInVault(this.app, img.src, file.path);
            if (!imageFile) {
              progress.log(`Image not found: ${img.src}`, 'error');
              continue;
            }
            try {
              const mimeType = guessMimeType(imageFile.path);
              const imageData = await this.app.vault.readBinary(imageFile);

              const { contentUri, tempDocId } = await getImageContentUri(token, imageData, mimeType);
              if (!contentUri) {
                progress.log(`Failed to upload: ${img.src}`, 'error');
                if (tempDocId) try { await deleteFile(token, tempDocId); } catch {}
                continue;
              }

              await batchUpdate(token, docId, [
                { deleteContentRange: { range: { startIndex: img.index, endIndex: img.index + 1 } } },
              ]);
              await batchUpdate(token, docId, [
                { insertInlineImage: { location: { index: img.index }, uri: contentUri } },
              ]);

              try { await deleteFile(token, tempDocId); } catch {}
            } catch (err) {
              progress.log(`Image error (${img.src}): ${(err as Error).message}`, 'error');
            }
          }
        }

        // Pass 2: apply styles
        if (styleRequests.length > 0) {
          progress.log('Applying formatting...');
          await batchUpdate(token, docId, styleRequests);
        }

        // Pass 3: insert tables
        if (tables.length > 0) {
          progress.log(`Inserting ${tables.length} table(s)...`);
          const docsApi = {
            getDocument: () => getDocument(token, docId),
            batchUpdate: (reqs: any[]) => batchUpdate(token, docId, reqs),
          };
          for (const tableInfo of tables) {
            await insertTableIntoDoc(docsApi, tableInfo);
          }
        }

        // Move to target folder
        progress.log('Moving to folder...');
        await moveFileToFolder(token, docId, folderId);

        const docUrl = await getFileWebLink(token, docId);
        converted++;
        progress.log(`Exported: ${title} -> ${docUrl}`, 'success');
      } catch (err) {
        progress.log(`Error exporting "${file.basename}": ${(err as Error).message}`, 'error');
      }
    }

    progress.finish(`Done! Exported ${converted} of ${this.files.length} file(s).`);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
