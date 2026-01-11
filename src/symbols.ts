export type SymbolSet = {
    functions: Set<string>;
    classes: Set<string>;
    variables: Set<string>;
    classMethods: Map<string, Set<string>>;
    variableTypes: Map<string, string>;
    objectProperties: Map<string, Set<string>>;
};

export function emptySymbols(): SymbolSet {
    return {
        functions: new Set<string>(),
        classes: new Set<string>(),
        variables: new Set<string>(),
        classMethods: new Map<string, Set<string>>(),
        variableTypes: new Map<string, string>(),
        objectProperties: new Map<string, Set<string>>()
    };
}

function addSymbol(map: Map<string, Set<string>>, key: string, value: string): void {
    let bucket = map.get(key);
    if (!bucket) {
        bucket = new Set<string>();
        map.set(key, bucket);
    }
    bucket.add(value);
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

function extractObjectKeys(text: string): string[] {
    const keys: string[] = [];
    const idRegex = /([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
    const strRegex = /"([^"]+)"\s*:/g;
    let match: RegExpExecArray | null;

    while ((match = idRegex.exec(text))) {
        keys.push(match[1]);
    }
    while ((match = strRegex.exec(text))) {
        keys.push(match[1]);
    }

    return keys;
}

export function parseSymbols(text: string): SymbolSet {
    const symbols = emptySymbols();
    const lines = text.split(/\r?\n/);
    const classStack: Array<{ name: string; indent: number }> = [];
    let activeObject: { name: string; indent: number } | null = null;
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
                const owner = classStack[classStack.length - 1].name;
                addSymbol(symbols.classMethods, owner, name);
            } else {
                symbols.functions.add(name);
            }
            continue;
        }

        const classAssignMatch = content.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
        if (classAssignMatch && indent === 0) {
            symbols.variableTypes.set(classAssignMatch[1], classAssignMatch[2]);
        }

        const objectStartMatch = content.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{/);
        if (objectStartMatch) {
            activeObject = { name: objectStartMatch[1], indent };
        }

        if (activeObject) {
            for (const key of extractObjectKeys(content)) {
                addSymbol(symbols.objectProperties, activeObject.name, key);
            }

            if (content.includes('}')) {
                activeObject = null;
            } else if (indent <= activeObject.indent && !objectStartMatch) {
                activeObject = null;
            }
        }

        const varMatch = content.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
        if (varMatch && indent === 0) {
            symbols.variables.add(varMatch[1]);
        }
    }

    return symbols;
}

export function mergeSymbols(target: SymbolSet, source: SymbolSet): void {
    for (const fn of source.functions) {
        target.functions.add(fn);
    }
    for (const cls of source.classes) {
        target.classes.add(cls);
    }
    for (const variable of source.variables) {
        target.variables.add(variable);
    }
    for (const [owner, methods] of source.classMethods.entries()) {
        for (const method of methods) {
            addSymbol(target.classMethods, owner, method);
        }
    }
}

export function getMemberCandidates(symbols: SymbolSet, target: string): { methods: string[]; properties: string[] } {
    const methods: string[] = [];
    const properties: string[] = [];

    const className = symbols.variableTypes.get(target) || (symbols.classes.has(target) ? target : null);
    if (className) {
        const classMethods = symbols.classMethods.get(className);
        if (classMethods) {
            methods.push(...classMethods);
        }
    }

    const props = symbols.objectProperties.get(target);
    if (props) {
        properties.push(...props);
    }

    return { methods, properties };
}
