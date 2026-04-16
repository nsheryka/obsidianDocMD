import { App, Modal, Setting } from 'obsidian';
import { computeLineDiff, computeWordDiff, WordSegment } from '../converters/diff';

export interface ConflictResolution {
  action: 'overwrite' | 'cancel' | 'rename';
  newFilename?: string;
}

export class ConflictModal extends Modal {
  private filePath: string;
  private existingContent: string;
  private newContent: string;
  private resolve: ((result: ConflictResolution) => void) | null = null;

  constructor(
    app: App,
    filePath: string,
    existingContent: string,
    newContent: string,
  ) {
    super(app);
    this.filePath = filePath;
    this.existingContent = existingContent;
    this.newContent = newContent;
  }

  waitForResolution(): Promise<ConflictResolution> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  onOpen(): void {
    this.showPromptView();
  }

  private resolveAndClose(result: ConflictResolution): void {
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r(result);
    }
    this.close();
  }

  private showPromptView(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.removeClass('docmd-diff-modal');
    contentEl.addClass('docmd-conflict-modal');

    const filename = this.filePath.split('/').pop() || this.filePath;
    this.titleEl.setText('File already exists');

    contentEl.createEl('p', {
      text: `"${filename}" already exists in the output folder. What would you like to do?`,
    });

    const btnRow = contentEl.createDiv({ cls: 'docmd-button-row' });

    btnRow.createEl('button', { text: 'Skip', cls: 'mod-warning' })
      .addEventListener('click', () => {
        this.resolveAndClose({ action: 'cancel' });
      });

    btnRow.createEl('button', { text: 'Rename' })
      .addEventListener('click', () => this.showRenameView());

    btnRow.createEl('button', { text: 'Review diff', cls: 'mod-cta' })
      .addEventListener('click', () => this.showDiffView());
  }

  private showRenameView(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.removeClass('docmd-diff-modal');

    const filename = this.filePath.split('/').pop()?.replace(/\.md$/, '') || 'document';
    this.titleEl.setText('Rename file');

    contentEl.createEl('p', { text: `Choose a new name to avoid overwriting ${filename}.md` });

    let inputValue = filename + '-copy';
    new Setting(contentEl)
      .setName('New filename')
      .addText(text => {
        text.setValue(inputValue);
        text.onChange(value => { inputValue = value; });
        text.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            const trimmed = inputValue.trim();
            if (trimmed) {
              this.resolveAndClose({ action: 'rename', newFilename: trimmed });
            }
          }
        });
      });

    const btnRow = contentEl.createDiv({ cls: 'docmd-button-row' });

    btnRow.createEl('button', { text: 'Back' })
      .addEventListener('click', () => this.showPromptView());

    btnRow.createEl('button', { text: 'Save', cls: 'mod-cta' })
      .addEventListener('click', () => {
        const trimmed = inputValue.trim();
        if (trimmed) {
          this.resolveAndClose({ action: 'rename', newFilename: trimmed });
        }
      });
  }

  private showDiffView(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('docmd-diff-modal');

    const filename = this.filePath.split('/').pop() || this.filePath;
    this.titleEl.setText(`Review Changes: ${filename}`);

    const oldLines = this.existingContent.split('\n');
    const newLines = this.newContent.split('\n');
    const diff = computeLineDiff(oldLines, newLines);

    const diffContainer = contentEl.createDiv({ cls: 'docmd-diff-container' });

    const leftCol = diffContainer.createDiv({ cls: 'docmd-diff-column docmd-diff-old' });
    leftCol.createDiv({ cls: 'docmd-diff-header', text: 'Existing' });
    const leftLines = leftCol.createDiv({ cls: 'docmd-diff-lines' });

    const rightCol = diffContainer.createDiv({ cls: 'docmd-diff-column docmd-diff-new' });
    rightCol.createDiv({ cls: 'docmd-diff-header', text: 'Incoming' });
    const rightLines = rightCol.createDiv({ cls: 'docmd-diff-lines' });

    for (const entry of diff) {
      if (entry.type === 'equal') {
        leftLines.createDiv({ cls: 'docmd-diff-line', text: entry.oldLine || '' });
        rightLines.createDiv({ cls: 'docmd-diff-line', text: entry.newLine || '' });
      } else if (entry.type === 'removed') {
        leftLines.createDiv({ cls: 'docmd-diff-line docmd-diff-removed', text: entry.oldLine || '' });
        rightLines.createDiv({ cls: 'docmd-diff-line docmd-diff-blank', text: '\u00A0' });
      } else if (entry.type === 'added') {
        leftLines.createDiv({ cls: 'docmd-diff-line docmd-diff-blank', text: '\u00A0' });
        rightLines.createDiv({ cls: 'docmd-diff-line docmd-diff-added', text: entry.newLine || '' });
      } else if (entry.type === 'modified') {
        const { oldSegments, newSegments } = computeWordDiff(entry.oldLine || '', entry.newLine || '');
        const leftLine = leftLines.createDiv({ cls: 'docmd-diff-line docmd-diff-removed' });
        this.renderWordSegments(leftLine, oldSegments, 'docmd-diff-removed-word');
        const rightLine = rightLines.createDiv({ cls: 'docmd-diff-line docmd-diff-added' });
        this.renderWordSegments(rightLine, newSegments, 'docmd-diff-added-word');
      }
    }

    // Sync scrolling
    leftLines.addEventListener('scroll', () => { rightLines.scrollTop = leftLines.scrollTop; });
    rightLines.addEventListener('scroll', () => { leftLines.scrollTop = rightLines.scrollTop; });

    const btnRow = contentEl.createDiv({ cls: 'docmd-button-row' });

    btnRow.createEl('button', { text: 'Cancel' })
      .addEventListener('click', () => {
        this.resolveAndClose({ action: 'cancel' });
      });

    btnRow.createEl('button', { text: 'Overwrite', cls: 'mod-warning' })
      .addEventListener('click', () => {
        this.resolveAndClose({ action: 'overwrite' });
      });
  }

  private renderWordSegments(container: HTMLElement, segments: WordSegment[], changeCls: string): void {
    for (const seg of segments) {
      if (seg.changed) {
        container.createSpan({ cls: changeCls, text: seg.text });
      } else {
        container.createSpan({ text: seg.text });
      }
    }
    // Ensure empty lines still have height
    if (segments.length === 0 || segments.every(s => s.text === '')) {
      container.createSpan({ text: '\u00A0' });
    }
  }

  onClose(): void {
    // If closed without choosing (e.g. Escape key), treat as cancel
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ action: 'cancel' });
    }
    this.contentEl.empty();
  }
}
