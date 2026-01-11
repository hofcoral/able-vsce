import { createConnection, TextDocuments, ProposedFeatures, TextDocumentSyncKind, CompletionItem, CompletionItemKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

type SymbolSet = {
    functions: Set<string>;
    classes: Set<string>;
    variables: Set<string>;
};

type ModuleEntry = {
    moduleName: string;
    symbols: SymbolSet;
};

const BUILTIN_FUNCTIONS = [
    'pr',
    'input',
    'type',
    'type_name',
    'len',
    'bool',
    'int',
    'float',
    'str',
    'list',
    'dict',
    'range',
    'register_modifier',
    'register_decorator',
    'server_listen',
    'json_stringify',
    'json_parse',
    'read_text_file',
    'string_trim',
    'string_split',
    'string_join',
    'string_replace',
    'string_contains',
    'string_starts_with',
    'string_ends_with',
    'string_lower',
    'string_upper'
];

const BUILTIN_TYPES = [
    'Number',
    'String',
    'Boolean',
    'List',
    'Object',
    'Function',
    'BoundMethod',
    'Type',
    'Instance',
    'Null',
    'Undefined',
    'Promise'
];

const BUILTIN_KEYWORDS = [
    'if',
    'elif',
    'else',
    'for',
    'of',
    'while',
    'break',
    'continue',
    'return',
    'async',
    'await',
    'class',
    'fun',
    'import',
    'from',
    'as',
    'true',
    'false',
    'null',
    'and',
    'or',
    'not',
    'is'
];

const BUILTIN_MODULES = [
    'api',
    'builtins',
    'math',
    'path',
    'random',
    'server',
    'string',
    'time'
];

const BUILTIN_DECORATORS = [
    'Route',
    'Get',
    'Post',
    'Put',
    'Patch',
    'Delete',
    'Head',
    'Options',
    'Use'
];

const SKIP_DIRS = new Set([
    '.git',
    '.vscode',
    'build',
    'coverage',
    'dist',
    'node_modules',
    'out',
    'vendor'
]);

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceRoot: string | null = null;
const moduleIndex = new Map<string, ModuleEntry>();
const moduleByFile = new Map<string, string>();

function emptySymbols(): SymbolSet {
    return {
        functions: new Set<string>(),
        classes: new Set<string>(),
        variables: new Set<string>()
    };
}

function getIndentLevel(line: string): number {
    let width = 0;
    for (const ch of line) {
        if (ch === ' ') {
            width += 1;
            continue;
        }
        if (ch === '\t') {
            width += 4;
            continue;
        }
        break;
    }
    return Math.floor((width + 2) / 4);
}

function stripLineComment(line: string, inBlockComment: boolean): { text: string; inBlockComment: boolean } {
    let output = '';
    let inString = false;
    let escaped = false;
    let i = 0;

    while (i < line.length) {
        if (!inString && !escaped && line.startsWith('##', i)) {
            inBlockComment = !inBlockComment;
            i += 2;
            continue;
        }

        if (inBlockComment) {
            i += 1;
            continue;
        }

        const ch = line[i];
        if (!inString && ch === '#') {
            break;
        }

        if (ch === '\\' && !escaped) {
            escaped = true;
            output += ch;
            i += 1;
            continue;
        }

        if (ch === '"' && !escaped) {
            inString = !inString;
        }

        escaped = false;
        output += ch;
        i += 1;
    }

    return { text: output, inBlockComment };
}

function parseSymbols(text: string): SymbolSet {
    const symbols = emptySymbols();
    const lines = text.split(/\r?\n/);
    const classStack: Array<{ name: string; indent: number }> = [];
    let inBlockComment = false;

    for (const line of lines) {
        const stripped = stripLineComment(line, inBlockComment);
        inBlockComment = stripped.inBlockComment;
        const content = stripped.text;

        if (content.trim() === '') {
            continue;
        }

        const indent = getIndentLevel(content);
        while (classStack.length > 0 && indent <= classStack[classStack.length - 1].indent) {
            classStack.pop();
        }

        const classMatch = content.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (classMatch) {
            const name = classMatch[1];
            symbols.classes.add(name);
            classStack.push({ name, indent });
            continue;
        }

        const funMatch = content.match(/^\s*(?:async\s+)?fun\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (funMatch) {
            const name = funMatch[1];
            if (classStack.length > 0) {
                // TODO: method completions can be added later using classStack.
            } else {
                symbols.functions.add(name);
            }
            continue;
        }

        const varMatch = content.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
        if (varMatch && indent === 0) {
            symbols.variables.add(varMatch[1]);
        }
    }

    return symbols;
}

function moduleNameForFile(filePath: string): string | null {
    if (!workspaceRoot) {
        return null;
    }

    const rel = path.relative(workspaceRoot, filePath);
    if (!rel || rel.startsWith('..')) {
        return null;
    }

    const normalized = rel.replace(/\\/g, '/');
    if (!normalized.endsWith('.abl')) {
        return null;
    }

    const parts = normalized.split('/');
    const last = parts[parts.length - 1];

    if (last === '__init__.abl') {
        parts.pop();
    } else {
        parts[parts.length - 1] = last.replace(/\.abl$/, '');
    }

    if (parts.length === 0) {
        return null;
    }

    return parts.join('.');
}

async function collectAbleFiles(dir: string): Promise<string[]> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const results: string[] = [];

    for (const entry of entries) {
        if (entry.name.startsWith('.')) {
            continue;
        }
        if (SKIP_DIRS.has(entry.name)) {
            continue;
        }

        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const nested = await collectAbleFiles(full);
            results.push(...nested);
        } else if (entry.isFile() && entry.name.endsWith('.abl')) {
            results.push(full);
        }
    }

    return results;
}

async function scanWorkspace(): Promise<void> {
    moduleIndex.clear();
    moduleByFile.clear();

    if (!workspaceRoot) {
        return;
    }

    let files: string[] = [];
    try {
        files = await collectAbleFiles(workspaceRoot);
    } catch (err) {
        connection.console.warn(`Failed to scan workspace: ${String(err)}`);
        return;
    }

    await Promise.all(
        files.map(async (filePath) => {
            const moduleName = moduleNameForFile(filePath);
            if (!moduleName) {
                return;
            }
            try {
                const text = await fs.promises.readFile(filePath, 'utf8');
                const symbols = parseSymbols(text);
                moduleIndex.set(moduleName, { moduleName, symbols });
                moduleByFile.set(filePath, moduleName);
            } catch (err) {
                connection.console.warn(`Failed to read ${filePath}: ${String(err)}`);
            }
        })
    );
}

function updateDocumentSymbols(doc: TextDocument): void {
    const filePath = uriToPath(doc.uri);
    if (!filePath) {
        return;
    }

    const moduleName = moduleNameForFile(filePath);
    if (!moduleName) {
        return;
    }

    const symbols = parseSymbols(doc.getText());
    moduleIndex.set(moduleName, { moduleName, symbols });
    moduleByFile.set(filePath, moduleName);
}

function uriToPath(uri: string): string | null {
    try {
        if (uri.startsWith('file://')) {
            return fileURLToPath(uri);
        }
    } catch {
        return null;
    }
    return null;
}

function gatherWorkspaceSymbols(): SymbolSet {
    const combined = emptySymbols();
    for (const entry of moduleIndex.values()) {
        for (const fn of entry.symbols.functions) {
            combined.functions.add(fn);
        }
        for (const cls of entry.symbols.classes) {
            combined.classes.add(cls);
        }
        for (const variable of entry.symbols.variables) {
            combined.variables.add(variable);
        }
    }
    return combined;
}

function toCompletionItems(items: Iterable<string>, kind: CompletionItemKind): CompletionItem[] {
    const completions: CompletionItem[] = [];
    const seen = new Set<string>();
    for (const item of items) {
        if (!item || seen.has(item)) {
            continue;
        }
        seen.add(item);
        completions.push({
            label: item,
            kind
        });
    }
    return completions;
}

function getImportCompletions(prefix: string): CompletionItem[] {
    const modules = new Set<string>(BUILTIN_MODULES);
    for (const name of moduleIndex.keys()) {
        modules.add(name);
    }

    const filtered = Array.from(modules).filter((mod) => mod.startsWith(prefix));
    return toCompletionItems(filtered, CompletionItemKind.Module);
}

function getModuleExports(moduleName: string): CompletionItem[] {
    const entry = moduleIndex.get(moduleName);
    if (!entry) {
        return [];
    }

    const symbols = entry.symbols;
    return [
        ...toCompletionItems(symbols.functions, CompletionItemKind.Function),
        ...toCompletionItems(symbols.classes, CompletionItemKind.Class),
        ...toCompletionItems(symbols.variables, CompletionItemKind.Variable)
    ];
}

function getFromImportCompletions(moduleName: string, prefix: string): CompletionItem[] {
    const exports = getModuleExports(moduleName);
    if (!prefix) {
        return exports;
    }
    return exports.filter((item) => item.label.startsWith(prefix));
}

connection.onInitialize((params) => {
    if (params.workspaceFolders && params.workspaceFolders.length > 0) {
        workspaceRoot = fileURLToPath(params.workspaceFolders[0].uri);
    } else if (params.rootUri) {
        workspaceRoot = fileURLToPath(params.rootUri);
    } else if (params.rootPath) {
        workspaceRoot = params.rootPath;
    }

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: false
            }
        }
    };
});

connection.onInitialized(() => {
    void scanWorkspace();
});

connection.onDidChangeWatchedFiles(() => {
    void scanWorkspace();
});

documents.onDidOpen((event) => {
    updateDocumentSymbols(event.document);
});

documents.onDidChangeContent((event) => {
    updateDocumentSymbols(event.document);
});

documents.onDidClose(() => {
    void scanWorkspace();
});

connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) {
        return [];
    }

    const lineText = doc.getText({
        start: { line: params.position.line, character: 0 },
        end: params.position
    });

    const decoratorMatch = lineText.match(/^\s*@([A-Za-z0-9_]*)$/);
    if (decoratorMatch) {
        const prefix = decoratorMatch[1] ?? '';
        return toCompletionItems(
            BUILTIN_DECORATORS.filter((name) => name.startsWith(prefix)),
            CompletionItemKind.Function
        );
    }

    const importMatch = lineText.match(/^\s*import\s+([A-Za-z0-9_.]*)$/);
    if (importMatch) {
        return getImportCompletions(importMatch[1] ?? '');
    }

    const fromMatch = lineText.match(/^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+([A-Za-z0-9_,\s]*)$/);
    if (fromMatch) {
        const moduleName = fromMatch[1];
        const importList = fromMatch[2] ?? '';
        const parts = importList.split(',');
        const prefix = parts[parts.length - 1].trim();
        return getFromImportCompletions(moduleName, prefix);
    }

    const localSymbols = gatherWorkspaceSymbols();
    const completions: CompletionItem[] = [
        ...toCompletionItems(BUILTIN_KEYWORDS, CompletionItemKind.Keyword),
        ...toCompletionItems(BUILTIN_TYPES, CompletionItemKind.Class),
        ...toCompletionItems(BUILTIN_FUNCTIONS, CompletionItemKind.Function),
        ...toCompletionItems(localSymbols.functions, CompletionItemKind.Function),
        ...toCompletionItems(localSymbols.classes, CompletionItemKind.Class),
        ...toCompletionItems(localSymbols.variables, CompletionItemKind.Variable)
    ];

    return completions;
});

documents.listen(connection);
connection.listen();
