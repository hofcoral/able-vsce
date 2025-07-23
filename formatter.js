const vscode = require('vscode');

function formatAbleDocument(document) {
    const edits = [];
    let indent = 0;
    const indentStr = '    ';
    let lastLineWasBlank = false;

    for (let i = 0; i < document.lineCount; i++) {
        let line = document.lineAt(i);
        let text = line.text.trim();

        // Skip blank lines but preserve one blank line
        if (text === '') {
            if (!lastLineWasBlank) {
                edits.push(vscode.TextEdit.replace(line.range, ''));
                lastLineWasBlank = true;
            }
            continue;
        }
        lastLineWasBlank = false;

        // Handle comments (lines starting with #)
        if (text.startsWith('#')) {
            edits.push(vscode.TextEdit.replace(line.range, indentStr.repeat(indent) + text));
            continue;
        }

        // Adjust indent for closing braces
        if (text.startsWith('}')) {
            indent = Math.max(0, indent - 1);
        }

        // Format the line with current indent
        edits.push(vscode.TextEdit.replace(line.range, indentStr.repeat(indent) + text));

        // Adjust indent for opening braces
        if (text.endsWith('{')) {
            indent++;
        }
    }

    // Ensure file ends with a newline
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
