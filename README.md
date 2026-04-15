# DocMD

Bidirectional Google Docs to Markdown conversion for Obsidian. Import Google Docs as Markdown notes and export Markdown notes as Google Docs, with full support for images, tables, formatting, and recursive link following.

## Features

- **Import Google Docs to Markdown** -- paste one or more Google Doc URLs and convert them to .md files in your vault
- **Export Markdown to Google Docs** -- export notes to Google Docs in a specified Drive folder
- **Image support** -- images are downloaded and saved as local attachments on import, and uploaded to Google Docs on export
- **Recursive link following** -- optionally follow links in documents and convert all linked docs/notes in one operation, with wikilinks preserved between them
- **Conflict resolution** -- when importing over an existing file, review a side-by-side diff with word-level highlighting before choosing to overwrite, skip, or rename
- **Optional YAML frontmatter** -- add configurable frontmatter (source URL, date, tags) to imported notes, with automatic stripping on export
- **Ribbon icons and context menu** -- quick access from the sidebar or by right-clicking files and folders
- **Formatting preservation** -- headings, bold, italic, strikethrough, inline code, code blocks, blockquotes, lists (ordered/unordered with nesting), tables, horizontal rules, and links

## Prerequisites

You need a Google Cloud project with OAuth credentials to connect the plugin to your Google account. This is a one-time setup:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Enable the **Google Docs API** and **Google Drive API** (search for each in the API library)
4. Go to **APIs & Services > Credentials > Create Credentials > OAuth 2.0 Client IDs**
5. Choose application type: **Desktop app**, give it a name, and click Create
6. Copy the **Client ID** and **Client Secret**
7. Go to the **OAuth consent screen** tab and add your Google account email as a **Test user**

These instructions are also available in the plugin's settings tab.

## Installation

### From Obsidian Community Plugins (coming soon)

Once accepted into the community plugin directory, search for "DocMD" in Obsidian's community plugin browser.

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/nsheryka/obsidianDocMD/releases/latest)
2. Create a folder called `docmd` in your vault's `.obsidian/plugins/` directory
3. Copy the three files into that folder
4. Restart Obsidian and enable DocMD in Settings > Community Plugins

### Via BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. In BRAT settings, click **Add Beta Plugin**
3. Enter `nsheryka/obsidianDocMD`

## Usage

### Setting Up

1. Open DocMD settings and enter your Client ID and Client Secret
2. Click **Connect Google Account**
3. Sign in with your Google account in the browser window that opens
4. Click Allow when prompted for Docs and Drive access

### Importing a Google Doc

1. Open the command palette (Cmd/Ctrl+P) and select **Import Google Doc to Markdown**
2. Paste one or more Google Doc URLs (one per line)
3. Choose an output folder in your vault
4. Optionally enable **Follow links recursively** to also convert linked documents
5. Click **Convert**

You can also right-click a folder and select **Import Google Doc here**.

### Exporting Markdown to Google Docs

1. Right-click a .md file and select **Export to Google Doc**, or use the command palette
2. Enter a Google Drive folder URL (the folder where the Doc will be created)
3. Optionally enable **Follow links recursively** to also convert linked notes
4. Click **Export**

You can also right-click a folder and select **Export folder to Google Docs** to batch export all .md files in it.

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Client ID | Google OAuth Client ID | (empty) |
| Client Secret | Google OAuth Client Secret | (empty) |
| Follow links recursively | Convert linked documents by default | Off |
| Enable YAML frontmatter | Show frontmatter options in conversion dialogs | Off |
| Frontmatter template | Customizable YAML template with `{sourceUrl}` and `{date}` variables | source, date, tags |
| Show ribbon icons | Import/export icons in the left sidebar | On |
| Show in context menu | Right-click options on files and folders | On |

## Troubleshooting

**"Google hasn't verified this app" warning during sign-in:** This is normal for personal OAuth projects. Click **Advanced**, then **Go to DocMD (unsafe)** to proceed. The plugin only accesses Google Docs and Drive with your explicit permission.

**"Not authenticated" when running a command:** Go to DocMD settings and click Connect Google Account.

**Images not downloading:** Check that your Google Doc's images are embedded (not linked from external URLs that require authentication).

**Token expired errors:** The plugin refreshes tokens automatically, but if your refresh token is revoked, disconnect and reconnect your Google account in settings.

## Development

```bash
git clone https://github.com/nsheryka/obsidianDocMD.git
cd obsidianDocMD
npm install
npm run build
```

For development with hot rebuild:

```bash
npm run dev
```

To test in Obsidian, symlink the repo into your vault's plugin directory:

```bash
ln -s /path/to/obsidianDocMD /path/to/vault/.obsidian/plugins/docmd
```

## License

[MIT](LICENSE)
