import * as path from 'path';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

import { registerFormatter } from './formatter';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
    registerFormatter(context);

    const serverModule = context.asAbsolutePath(path.join('out', 'server.js'));
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] }
        }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'able' }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.abl')
        }
    };

    client = new LanguageClient('ableLanguageServer', 'Able Language Server', serverOptions, clientOptions);
    client.start();
    context.subscriptions.push({
        dispose: () => {
            void client?.stop();
        }
    });
}

export async function deactivate(): Promise<void> {
    if (client) {
        await client.stop();
    }
}
