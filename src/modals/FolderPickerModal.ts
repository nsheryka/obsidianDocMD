import { App, FuzzySuggestModal, TFolder } from 'obsidian';

export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
  private onChoose: (folder: TFolder) => void;

  constructor(app: App, onChoose: (folder: TFolder) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder('Choose a folder...');
  }

  getItems(): TFolder[] {
    const folders: TFolder[] = [];
    const root = this.app.vault.getRoot();
    folders.push(root);
    this.collectFolders(root, folders);
    return folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path || '/';
  }

  onChooseItem(folder: TFolder): void {
    this.onChoose(folder);
  }

  private collectFolders(folder: TFolder, result: TFolder[]): void {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        result.push(child);
        this.collectFolders(child, result);
      }
    }
  }
}
