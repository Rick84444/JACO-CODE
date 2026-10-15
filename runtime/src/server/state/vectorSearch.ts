import { MemoryNode } from './memoryStoreV2.js';

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) throw new Error("Vectors must have the same length");
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Basic in-memory vector search for SQLite (since we don't have sqlite-vss compiled in).
 * It extracts all embeddings and calculates cosine similarity in Node.
 * Suitable for a local Android assistant context up to a few thousand nodes.
 */
export function searchByEmbedding(nodes: MemoryNode[], queryEmbedding: Float32Array, topK: number = 5): Array<{node: MemoryNode, score: number}> {
    const results = nodes
        .filter(n => n.embedding !== undefined && n.embedding !== null)
        .map(node => {
            const score = cosineSimilarity(queryEmbedding, node.embedding!);
            return { node, score };
        });

    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}
