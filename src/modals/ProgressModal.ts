import { App, Modal } from 'obsidian';

export class ProgressModal extends Modal {
  private logContainer: HTMLElement;
  private closeButton: HTMLButtonElement;
  private finished = false;

  constructor(app: App, title: string) {
    super(app);
    this.titleEl.setText(title);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('docmd-progress-modal');

    this.logContainer = contentEl.createDiv({ cls: 'docmd-progress-log' });

    this.closeButton = contentEl.createEl('button', { text: 'Close', cls: 'mod-cta docmd-log-hidden' });
    this.closeButton.addEventListener('click', () => this.close());
  }

  log(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    const entry = this.logContainer.createDiv({ cls: `docmd-log-entry docmd-log-${type}` });
    entry.setText(message);
    // Auto-scroll to bottom
    this.logContainer.scrollTop = this.logContainer.scrollHeight;
  }

  finish(message?: string): void {
    if (message) {
      this.log(message, 'success');
    }
    this.finished = true;
    this.closeButton.removeClass('docmd-log-hidden');
  }

  showError(message: string): void {
    this.log(message, 'error');
    this.finished = true;
    this.closeButton.removeClass('docmd-log-hidden');
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
