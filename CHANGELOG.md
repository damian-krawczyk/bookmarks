# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.1.0] - 2026-11-07

First version.

### Added

- **`bookmarks.md` as the only data.** Headings are folders (up to 6 levels). A bookmark is a
  line: `- [name](url) — description`. Tags (`tags: #a #b`) and further description lines are
  optional and indented. The page writes the file back in this same form and keeps the order of
  entries, so git diffs stay small. Lines that aren't bookmarks are kept as notes.
- **Command line:**
  - `serve`: edit in the browser at http://127.0.0.1:4180/.
  - `build`: one self-contained, read-only HTML page that works offline.
  - `validate`: checks for bad or duplicate URLs and lines that aren't bookmarks.
  - `import` / `export`: browser bookmark files (Chrome, Firefox, Safari, Edge). Import keeps
    the folders and skips duplicates.
- **Folder tree** with counts. Click a folder to list it and its subfolders. In `serve` mode you
  can add, rename and delete folders, and drag bookmarks or folders onto a folder to move them.
- **Search** filters as you type across name, link, description, tags and folder. It ignores
  accents and case, and highlights matches. `#tag` filters by tag. Enter opens the first result.
- **Cards** show the full address (`https://…`, `http://…` and so on), description, tags and
  folder.
- **Graph view:** folders, bookmarks and tags laid out by a force simulation, filtered by the
  search. Hover a node to see its neighbours, click it for details, double-click to open it.
- **Editor** (in `serve` mode): link, name, description, tags (with suggestions) and folder (pick
  one, or type a new path like `Dev/JS`). ↻ fetches the page's title and description. It warns
  when a link is already saved.
- **"+ Bookmark" bookmarklet:** saves the page you're on while `serve` is running.
- **Safe saving:** files are written atomically. A save is refused if the file changed on disk
  since the page loaded, and the page then reloads the latest version. Pages reload live when the
  file is edited elsewhere.
- **Dark and light themes:** automatic, light or dark. Dialogs use the theme too.
- **Interface in English, Polish and Spanish.** To add a language, add one JSON file. A test
  checks that every language has the same texts.
- **Keyboard:** `/` search, `n` new bookmark, `g` list/graph, `Esc` close.
- **GitHub Pages workflow:** tests, builds and deploys the page on every push to `main`.
- **VS Code tasks:** serve (Cmd+Shift+B), serve the current file, build, validate, test.
- **Build information** at the bottom of the sidebar shows when the page was built and the
  commit it was built from, for example *Built Nov 7, 2026, 4:06 PM · commit 19a6cc5*. The
  hash links to the commit on GitHub. The commit comes from the repository that holds the
  bookmarks file. On GitHub Actions, if git isn't available, `GITHUB_SHA` is used. The time is
  shown in the viewer's time zone and language.
- **Using the tool with your own bookmarks repository** (README): three ways to install it (as
  a dev dependency, globally, or from a clone), a VS Code task, and how to publish your repo to
  GitHub Pages, including what that means for a private repository.

### Changed

- **The file's title is now YAML front matter** (`---` / `title: My bookmarks` / `---`) instead of
  `<!-- title: … -->`. GitHub shows it as a table, and tools like Obsidian read it. Any other
  fields (`created`, `tags`, `week`…) are kept exactly as written. New files start with `title`
  and `created` (local time with its UTC offset, for example `2026-11-07T14:08:10+0100`). Files
  using the old comment are still read, and switch to front matter on their next save.
- `bookmarks serve <file>` creates the file if it doesn't exist. Before, it did this only when
  no file was named.

### Fixed

- **Global install:** `bookmarks` gave `command not found` or `permission denied`.
  `bin/bookmarks.js` is now executable in git. The README now installs from the GitHub tarball
  URL, because `npm install -g github:…` can link the command to a temporary clone that npm
  deletes.
- **GitHub Pages workflow:** tests failed on Node 22 because `node --test test/` treated the
  folder as a file. The test script now lists `test/*.test.js`.
- **Mobile:** tapping the search box (or any field) no longer zooms the page on iOS. Fields are
  16px on touch screens. Pinch-to-zoom still works.

[0.1.0]: https://github.com/damian-krawczyk/bookmarks/commit/a901fb6
