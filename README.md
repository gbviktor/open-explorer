# Open Explorer

A Windows-Explorer-style file manager that runs in your browser, built around a fast, safe **duplicate file finder**.

```bash
npm start        # or: node server.js
```

Open http://localhost:5180. Node.js 18.15+ is required, and there are no dependencies to install.

## Features

**Explorer**
- This PC view with drive usage, Quick access, a navigation pane, and a breadcrumb address bar you can also type into (Ctrl+L)
- Details and Tiles views (tiles show image thumbnails), sortable columns, and a preview pane for images, video, audio, PDF and text
- New folder or file, inline rename (F2), cut/copy/paste, drag & drop (hold Ctrl to copy), Move to…/Copy to…
- Delete sends items to the **Recycle Bin**. Shift+Del deletes permanently.
- Filter-as-you-type. Press Enter to search subfolders (`*.jpg` wildcards work).
- Explorer keyboard shortcuts, type-ahead, mouse back/forward buttons, and right-click context menus

**Duplicate Finder**
- Scan any number of folders or drives. You can filter by size and file type, and skip folders such as `node_modules`.
- Exact matching runs in stages: same size → hash of the first and last 64 KB → full SHA-1. Files that are already hard links of each other are not counted.
- Name+size and name-only modes are also available for quick checks.
- Auto-select can keep the newest, oldest, shortest path, longest path, or first copy. It can also keep or remove copies in a chosen folder, or remove files named like copies ("(1)", "- Copy").
- What you can do with the selected copies: **Move to Recycle Bin**, Move to folder, **Replace with hard links** (each file is re-verified first), Delete permanently, or Export CSV.
- Every group always keeps at least one file.

## Security
The server only listens on `127.0.0.1`. It rejects foreign Host headers, which protects against DNS rebinding. Write requests must include a custom header. User files are served with a sandbox CSP, so a file can never run scripts in the app.
