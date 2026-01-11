# Able Lang Support

VS Code extension for Able language support.

## Features

- Syntax highlighting for Able language files
- Formatting with indentation awareness
- Autocomplete for imports, functions, classes, and built-in types
- Member autocomplete for class methods and object keys

## Installation

1. Download the latest `.vsix` release or build it yourself:
   ```sh
   ./scripts/compile-vsix.sh
   ```
2. Install the extension in VS Code:
   ```sh
   code --install-extension able-*.vsix
   ```

## Development

- Clone the repository
- Run `npm install`
- Use `npm run watch` while developing (or `npm run compile`)
- Press `F5` in VS Code to launch the extension host
- Use `./scripts/compile-vsix.sh` to build and package

## Settings

- `able.stdlibPaths`: extra directories to scan for modules (e.g. `/path/to/able/lib`).
- `able.useEnvAblePath`: include `ABLEPATH` when resolving modules (default: true).

## License

MIT License. See [LICENSE](./LICENSE) for details.
