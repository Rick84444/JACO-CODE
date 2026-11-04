import { insertMemoryNode, linkNodes, searchMemoryNodes, MemoryNode } from './memoryStoreV2.js';
import { searchByEmbedding } from './vectorSearch.js';
import { randomUUID } from 'crypto';

// A bridge between AppFunctions and the SQLite memory.
// When we run code refactoring, Git ops or audits,
// we store the result here to build context over time.

export function logActionToMemory(actionType: string, content: string, tags: string[] = []) {
    const id = randomUUID();
    const node: MemoryNode = {
        id,
        type: 'action_result',
        content: `Action: ${actionType}\nResult: ${content}`,
        tags: ['appfunctions', actionType, ...tags],
        // embedding: generated asynchronously via AICore later
    };
    insertMemoryNode(node);
    return id;
}

export function logErrorToMemory(context: string, errorMsg: string) {
    const id = randomUUID();
    const node: MemoryNode = {
        id,
        type: 'error_log',
        content: `Error in ${context}: ${errorMsg}`,
        tags: ['error', context]
    };
    insertMemoryNode(node);
    return id;
}

export function logCodeSnippet(filePath: string, snippet: string, tags: string[] = []) {
    const id = randomUUID();
    const node: MemoryNode = {
        id,
        type: 'code_snippet',
        content: `File: ${filePath}\n\n${snippet}`,
        tags: ['code', filePath, ...tags]
    };
    insertMemoryNode(node);
    return id;
}
