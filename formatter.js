const vscode = require('vscode');

const INDENT = '    ';
const INDENT_WIDTH = INDENT.length;
const BLOCK_KEYWORDS = /^(?:if|elif|else|for|while|class|async\s+fun|fun)\b/;

function isBlank(line) {
    return line.trim() === '';
}

function getIndentLevel(line) {
    let width = 0;
    for (const ch of line) {
        if (ch === ' ') {
            width += 1;
            continue;
        }
        if (ch === '\t') {
            width += INDENT_WIDTH;
            continue;
        }
        break;
    }
    return Math.floor((width + INDENT_WIDTH / 2) / INDENT_WIDTH);
}

function shouldDecrease(line) {
    const trimmed = line.trim();
    return /^(elif\b.*:|else:)/.test(trimmed);
}

function shouldIncrease(line) {
    const trimmed = line.trim();

    if (trimmed.endsWith('{')) {
        return true;
    }

    if (trimmed.endsWith('[')) {
        return true;
    }

    if (/:\s*$/.test(trimmed)) {
        return BLOCK_KEYWORDS.test(trimmed);
    }

    return false;
}

function formatAbleDocument(document) {
    const edits = [];
    let indent = 0;
    let lastBlank = false;

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const text = line.text;

        if (isBlank(text)) {
            if (!lastBlank) {
                edits.push(vscode.TextEdit.replace(line.range, ''));
                lastBlank = true;
            }
            continue;
        }
        lastBlank = false;

        const originalIndent = getIndentLevel(text);

        if (shouldDecrease(text)) {
            indent = Math.max(0, indent - 1);
        }

        if (originalIndent < indent) {
            indent = originalIndent;
        }

        const formatted = INDENT.repeat(indent) + text.trim();
        edits.push(vscode.TextEdit.replace(line.range, formatted));

        if (shouldIncrease(text)) {
            indent++;
        }
    }

    const lastLine = document.lineAt(document.lineCount - 1);
    if (lastLine.text !== '') {
        edits.push(vscode.TextEdit.insert(lastLine.range.end, '\n'));
    }

    return edits;
}

function activate(context) {
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('able', {
            provideDocumentFormattingEdits(document) {
                return formatAbleDocument(document);
            }
        })
    );
}

exports.activate = activate;
