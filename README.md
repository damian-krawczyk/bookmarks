# bookmarks

Your bookmarks in one human-readable Markdown file, [`bookmarks.md`](bookmarks.md). The file reads
well on GitHub and diffs cleanly in git. You browse and edit it in a web page with a folder tree,
instant search, tags, a graph view, dark/light mode and an English / Polish / Spanish interface.
The same file builds into a single static HTML page for GitHub Pages.

## Quick start

```sh
npm install
npm run serve        # edit bookmarks.md at http://127.0.0.1:4180/ (opens the browser)
npm run dev          # the same, with the sample examples/bookmarks.md
npm run build        # dist/index.html: self-contained, read-only, works offline
npm test
```

Editing works only in `serve` mode. Every change is written straight to `bookmarks.md`. If you
edit the file yourself (in an editor, or with `git pull`), open pages reload. If the file changed
since the page loaded, the save is refused and the page reloads the latest version, so nothing is
overwritten silently.

## Keeping your bookmarks in your own repository

The tool can serve, edit and build a bookmarks file in any folder. You don't need to fork or copy
this repo. For example, you can keep your bookmarks in a private repo and use this one only as
the tool. Pick one of these three setups.

### Option 1: add the tool to your bookmarks repo (recommended)

In your bookmarks repository:

```sh
npm init -y
npm install --save-dev github:damian-krawczyk/bookmarks
```

Add these scripts to its `package.json`:

```json
"scripts": {
  "serve": "bookmarks serve bookmarks.md --open",
  "build": "bookmarks build bookmarks.md -o dist/index.html",
  "validate": "bookmarks validate bookmarks.md"
}
```

Add a `.gitignore` containing:

```
node_modules/
dist/
```

`npm run serve` then edits that repo's own `bookmarks.md`. If the file doesn't exist yet, it is
created. The repo holds only `bookmarks.md`, `package.json`, `package-lock.json` and
`.gitignore`. The lock file pins the tool to one commit, so it changes only when you run
`npm update bookmarks`.

If the tool's repository is private, npm needs access to it through your GitHub SSH key or
credentials.

### Option 2: install the command globally

```sh
npm install -g https://codeload.github.com/damian-krawczyk/bookmarks/tar.gz/main
cd path/to/your-bookmarks-repo
bookmarks serve --open          # uses ./bookmarks.md, created if missing
```

Run the same install command again to update. Alternatively, run `npm link` in a clone of this
repo. Use the tarball URL above rather than `github:damian-krawczyk/bookmarks`: with `-g`, npm
can link the command to a temporary clone that it then deletes, and you get
`command not found: bookmarks`. If zsh still reports that after installing, run `rehash` or open
a new terminal.

This is the most convenient setup, but your bookmarks repo doesn't record which version of the
tool it uses.

### Option 3: run it from a clone of this repo

```sh
node path/to/bookmarks/bin/bookmarks.js serve path/to/your-bookmarks-repo/bookmarks.md --open
```

This needs no setup, but it only works on machines where this repo is cloned at that path.

### VS Code task

To start the server with **Cmd+Shift+B** (Ctrl+Shift+B on Windows and Linux), add
`.vscode/tasks.json` to your bookmarks repo:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Serve bookmarks.md on the LOCALHOST",
      "type": "shell",
      "command": "npx bookmarks serve bookmarks.md --open",
      "group": { "kind": "build", "isDefault": true },
      "isBackground": true,
      "problemMatcher": {
        "owner": "bookmarks",
        "pattern": { "regexp": "^(no such file): (.*)$", "kind": "file", "file": 2, "message": 1 },
        "background": { "activeBegins": true, "beginsPattern": "^(serving |created )", "endsPattern": "^serving .* at http://" }
      }
    }
  ]
}
```

### Publishing your bookmarks repo to GitHub Pages

Copy [`.github/workflows/pages.yml`](.github/workflows/pages.yml) into your repo. Replace its
`npm test` and `node bin/bookmarks.js …` steps with:

```yaml
      - run: npx bookmarks validate bookmarks.md
      - run: npx bookmarks build bookmarks.md -o dist/index.html
```

Then turn on Pages in the repo's **Settings → Pages → Source → GitHub Actions**.

- On GitHub Free, Pages works only from a public repository.
- On paid plans, a site published from a private repository is still public, unless you're on
  GitHub Enterprise, which can restrict it.
- To keep your bookmarks private, skip Pages:
  - Run `npm run serve` to edit them, then push the Markdown file as a backup with its full history.
  - `npm run build` produces a single `index.html` that works offline.

## The file format

```md
---
title: My bookmarks
created: 2026-11-07T14:08:10+0100
---

- [A link with no folder](https://example.com)

# Dev

## JavaScript

- [MDN](https://developer.mozilla.org) — Web docs
  tags: #docs #js
  More description lines are
  indented like this.
```

- The YAML front matter between the `---` lines is optional. `title:` sets the page title. Any
  other fields (`created`, `tags`, `week`…) are kept exactly as you wrote them. New files start
  with `title` and `created`. Files using the old `<!-- title: … -->` comment are still read, and
  are switched to front matter the next time they're saved.
- Headings are folders: `#` is a top-level folder, `##` a subfolder, and so on, up to 6 levels
  (Markdown's limit).
- `- [name](url) — description` is a bookmark. The `tags:` line and any further indented lines
  are optional.
- The page writes the file back in this canonical form and keeps the order of entries, so diffs
  stay small. Lines that aren't bookmarks are kept as notes, and `validate` warns about them.

### Converting other files with an AI assistant

Browser exports are handled by [`bookmarks import`](#importing-and-exporting-browser-bookmarks).
For anything else (a list of links, notes, a spreadsheet or CSV, an Obsidian or Notion export,
Pocket or Raindrop exports, a chat log full of URLs), paste the prompt below into an AI assistant
such as Claude, followed by your file. Save the answer as `bookmarks.md`, then check it:

```sh
bookmarks validate bookmarks.md     # or: node bin/bookmarks.js validate bookmarks.md
```

To add the result to an existing file, convert it to a separate file first, then copy the
folders you want across. The app merges folders with the same name when it next saves.

````text
Convert the input below into a bookmarks file in exactly this Markdown format. Output only the
file, with no explanation and no code fence around it.

FORMAT

---
title: <a short title for the collection>
created: <current date and time, like 2026-11-07T14:08:10+0100>
---

- [Name](https://url) — Optional one-line description
  tags: #tag1 #tag2

# Top-level folder

- [Name](https://url) — Description
  tags: #tag

## Subfolder

### Sub-subfolder

- [Name](https://url)

RULES

1. Front matter: keep the --- lines. If the input has its own front matter or metadata (created
   date, tags, author…), copy those fields into the front matter unchanged and add title: if
   it's missing.
2. Folders are headings: # is a top-level folder, ## a subfolder, ### a sub-subfolder, at most 6
   levels (######). Never skip a level (no ### directly under #). Folder names must not contain
   "/". Put a blank line after each heading.
3. Keep the input's own structure (folders, categories, sections, columns, groupings) as
   folders. If there is none, group the links into a few sensible folders by topic. Don't
   invent more than about 10 top-level folders. Links that fit nowhere go at the top, before the
   first heading.
4. One bookmark per line: "- [Name](URL)". Then, only if there is a description, a space, an em
   dash "—", a space and the description on the same line.
   - Name: the link's title from the input; otherwise a short human title based on the page or
     domain (for example "MDN – Array.prototype.map", not the raw URL). Escape [ and ] in names
     as \[ and \].
   - URL: complete and absolute, with https:// or http://. Keep query strings and fragments.
     Replace spaces in URLs with %20. Don't shorten, guess or "fix" URLs. Skip javascript:
     bookmarklets and entries without a usable URL.
   - Description: from the input (note, excerpt, comment, column). Keep it to one sentence. If
     the input has a longer note, put the extra lines on the following lines, indented by two
     spaces, after the tags line. Don't make up descriptions.
5. Tags: if the input has tags, labels or keywords, write them on the line right after the
   bookmark, indented by two spaces: "  tags: #tag1 #tag2". Use lowercase, no spaces inside
   a tag (use - instead), no commas. You may add one or two obvious topic tags when the input has
   none, but stay consistent: reuse the same tag for the same topic.
6. Remove exact duplicate URLs. Keep the first one and merge its tags and description.
7. Keep the input's order within each folder. Don't add commentary, notes or text outside this
   format. Every non-empty line must be front matter, a heading, a bookmark, its tags line, or
   its indented description lines.
8. Keep names and descriptions in their original language. Don't translate them.

INPUT

<paste your file here>
````

## In the browser

- **Tree**: click a folder to list it, including its subfolders. Hover a folder to add a subfolder,
  rename it or delete it. Drag bookmarks or folders onto a folder to move them.
- **Search**: filters as you type across name, link, description, tags and folder. It ignores
  accents (`espana` finds `España`). `#tag` filters by tag, and terms combine. Enter opens the
  first result.
- **Graph**: folders (squares), bookmarks (dots) and tags (diamonds), with lines for what contains
  or is tagged with what. It shows only what the search matches. Click a node for details,
  double-click to open it.
- **Add**: the *Add bookmark* button, or the **+ Bookmark** bookmarklet. Drag the bookmarklet
  from the sidebar to your bookmarks bar, then click it on any page to save that page here while
  `serve` is running. ↻ fetches the page's title and description.
- **Keys**: `/` search, `n` new bookmark, `g` list/graph, `Esc` close.
- The theme (auto/light/dark) and language are remembered per browser.

## Importing and exporting browser bookmarks

```sh
# Chrome/Edge/Firefox/Safari → "Export bookmarks" gives an HTML file:
node bin/bookmarks.js import ~/Downloads/bookmarks.html --into bookmarks.md --under "Imported"
# and back, for any browser's "Import bookmarks":
node bin/bookmarks.js export bookmarks.md -o bookmarks.html
```

Import keeps the browser's folders and skips URLs that are already in the file, so you can run it
again later. Folders deeper than 6 levels are merged into their 6th-level parent.

## GitHub Pages

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs the tests on every push to
`main` that changes `bookmarks.md` (or the code), then builds the page and deploys it. One-time
setup: in the repo, go to **Settings → Pages → Source** and choose **GitHub Actions**.

The deployed page is read-only. To edit, run `npm run serve` locally, then commit and push. If the
repository is public, your bookmarks are public too (GitHub Pages on a private repository needs a
paid plan).

## Adding a language

1. Copy `src/locales/en.json` to `src/locales/<code>.json`, for example `de.json`, and translate
   the values. Set `_name` to the language's own name (`Deutsch`).
2. Plurals use [CLDR categories](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)
   as key suffixes (`.one`, `.few`, `.many`, `.other`). Include the ones your language uses.
3. Run `npm test`, which checks that every language has the same keys as English. The new
   language then appears in the picker. The build includes every file in `src/locales/`.

## Layout

```
bin/bookmarks.js   CLI: serve, build, validate, import, export
src/model.js       bookmarks.md ⇄ folder tree; edit operations (shared by Node and the page)
src/app.js         the page: tree, list, search, editor, theme, language
src/graph.js       graph view (d3 force layout)
src/i18n.js        translations, plurals
src/locales/       en.json, pl.json, es.json
src/netscape.js    browser bookmark HTML import/export
src/template.html  page shell; build inlines CSS, JS, d3, translations and data into it
```

The only dependency is [d3](https://d3js.org) (ISC), which is inlined into the built page.
