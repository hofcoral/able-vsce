import { createConnection, TextDocuments, ProposedFeatures, TextDocumentSyncKind, CompletionItem, CompletionItemKind, DidChangeConfigurationNotification } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { SymbolSet, emptySymbols, parseSymbols, mergeSymbols, getMemberCandidates } from './symbols';

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
let hasConfigurationCapability = false;
let stdlibPaths: string[] = [];
let useEnvAblePath = true;
let searchRoots: string[] = [];


function normalizePath(input: string): string {
    if (input.startsWith('~')) {
        const home = process.env.HOME || process.env.USERPROFILE || '';
        return path.resolve(home, input.slice(1));
    }
    if (!path.isAbsolute(input) && workspaceRoot) {
        return path.resolve(workspaceRoot, input);
    }
    return path.resolve(input);
}

function resolveEnvAblePaths(): string[] {
    if (!useEnvAblePath) {
        return [];
    }
    const envPath = process.env.ABLEPATH;
    if (!envPath) {
        return [];
    }
    return envPath.split(path.delimiter).filter(Boolean);
}

function updateSearchRoots(): void {
    const roots = new Set<string>();
    if (workspaceRoot) {
        roots.add(workspaceRoot);
        const libRoot = path.join(workspaceRoot, 'lib');
        if (fs.existsSync(libRoot)) {
            roots.add(libRoot);
        }
    }
    for (const raw of stdlibPaths) {
        const resolved = normalizePath(raw);
        if (fs.existsSync(resolved)) {
            roots.add(resolved);
        }
    }
    for (const raw of resolveEnvAblePaths()) {
        const resolved = normalizePath(raw);
        if (fs.existsSync(resolved)) {
            roots.add(resolved);
        }
    }
    searchRoots = Array.from(roots);
}

async function loadConfig(): Promise<void> {
    if (hasConfigurationCapability) {
        const config = await connection.workspace.getConfiguration('able');
        stdlibPaths = Array.isArray(config?.stdlibPaths) ? config.stdlibPaths : [];
        useEnvAblePath = config?.useEnvAblePath !== false;
    } else {
        stdlibPaths = [];
        useEnvAblePath = true;
    }
    updateSearchRoots();
}

function moduleNameForFile(filePath: string): string | null {
    for (const root of searchRoots) {
        const rel = path.relative(root, filePath);
        if (!rel || rel.startsWith('..')) {
            continue;
        }

        const normalized = rel.replace(/\\/g, '/');
        if (!normalized.endsWith('.abl')) {
            continue;
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
    return null;
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

    if (!workspaceRoot && searchRoots.length === 0) {
        return;
    }

    const files: string[] = [];
    for (const root of searchRoots) {
        try {
            const entries = await collectAbleFiles(root);
            files.push(...entries);
        } catch (err) {
            connection.console.warn(`Failed to scan ${root}: ${String(err)}`);
        }
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
        mergeSymbols(combined, entry.symbols);
    }
    return combined;
}

function getModuleEntryForDoc(doc: TextDocument): ModuleEntry | undefined {
    const filePath = uriToPath(doc.uri);
    if (!filePath) {
        return undefined;
    }
    const moduleName = moduleNameForFile(filePath);
    if (!moduleName) {
        return undefined;
    }
    return moduleIndex.get(moduleName);
}

function getMemberCompletions(target: string, entry?: ModuleEntry): CompletionItem[] {
    if (!entry) {
        return [];
    }
    const completions: CompletionItem[] = [];
    const candidates = getMemberCandidates(entry.symbols, target);
    completions.push(...toCompletionItems(candidates.methods, CompletionItemKind.Method));
    completions.push(...toCompletionItems(candidates.properties, CompletionItemKind.Property));

    return completions;
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
    hasConfigurationCapability = !!(params.capabilities.workspace && params.capabilities.workspace.configuration);
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
    if (hasConfigurationCapability) {
        void connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    void loadConfig().then(() => {
        void scanWorkspace();
    });
});

connection.onDidChangeWatchedFiles(() => {
    void scanWorkspace();
});

connection.onDidChangeConfiguration(async () => {
    await loadConfig();
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

    const memberMatch = lineText.match(/([A-Za-z_][A-Za-z0-9_]*)\.$/);
    if (memberMatch) {
        const entry = getModuleEntryForDoc(doc);
        const completions = getMemberCompletions(memberMatch[1], entry);
        if (completions.length > 0) {
            return completions;
        }
    }

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
