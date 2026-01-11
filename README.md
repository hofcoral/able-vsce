# Able Lang Support

VS Code extension for Able language support.

## Features

- Syntax highlighting for Able language files
- Formatting with indentation awareness
- Autocomplete for imports, functions, classes, and built-in types

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
- Use `./scripts/compile-vsix.sh` to build and package

## License

MIT License. See [LICENSE](./LICENSE) for details.
