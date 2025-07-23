#!/bin/bash
set -e

# Compile TypeScript (if present)
if [ -f "tsconfig.json" ]; then
  npx tsc
fi

# Package the extension as .vsix
npx vsce package

echo "VSIX package created."
