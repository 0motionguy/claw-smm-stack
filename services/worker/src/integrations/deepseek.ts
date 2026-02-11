import { QdrantClient } from '@qdrant/js-client-rest';
import axios from 'axios';
import { logger } from '../utils/logger';

/**
 * Qdrant vector search client for context storage and retrieval
 * Uses DeepSeek embeddings for vector generation
 */

export interface ContextResult {
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

export class DeepSeekVectorStore {
  private readonly qdrant: QdrantClient;
  private readonly embeddingDimension = 1536; // DeepSeek embedding dimension

  constructor() {
    const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
    const qdrantApiKey = process.env.QDRANT_API_KEY;

    this.qdrant = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey,
    });
  }

  /**
   * Store context with embeddings
   * @param tenantId - Tenant identifier
   * @param text - Text to store
   * @param metadata - Additional metadata
   */
  async storeContext(
    tenantId: string,
    text: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      const collectionName = this.getCollectionName(tenantId);

      // Ensure collection exists
      await this.ensureCollection(collectionName);

      // Generate embedding
      const embedding = await this.generateEmbedding(text);

      // Store in Qdrant
      const pointId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      await this.qdrant.upsert(collectionName, {
        wait: true,
        points: [
          {
            id: pointId,
            vector: embedding,
            payload: {
              text,
              tenant_id: tenantId,
              created_at: new Date().toISOString(),
              ...metadata,
            },
          },
        ],
      });

      logger.info('Context stored in vector DB', {
        action: 'vector_store',
        tenant_id: tenantId,
        point_id: pointId,
        text_length: text.length,
      });
    } catch (error) {
      logger.error('Failed to store context', {
        action: 'vector_store_error',
        tenant_id: tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Retrieve relevant context using semantic search
   * @param tenantId - Tenant identifier
   * @param query - Search query
   * @param k - Number of results to return
   * @returns Array of matching context results
   */
  async retrieveContext(
    tenantId: string,
    query: string,
    k: number = 10
  ): Promise<ContextResult[]> {
    try {
      const collectionName = this.getCollectionName(tenantId);

      // Check if collection exists
      const collections = await this.qdrant.getCollections();
      const collectionExists = collections.collections.some(
        (c) => c.name === collectionName
      );

      if (!collectionExists) {
        logger.warn('Collection does not exist', {
          action: 'vector_retrieve_no_collection',
          tenant_id: tenantId,
          collection: collectionName,
        });
        return [];
      }

      // Generate query embedding
      const queryEmbedding = await this.generateEmbedding(query);

      // Search in Qdrant
      const searchResults = await this.qdrant.search(collectionName, {
        vector: queryEmbedding,
        limit: k,
        with_payload: true,
      });

      const results: ContextResult[] = searchResults.map((result) => ({
        text: (result.payload?.text as string) || '',
        score: result.score,
        metadata: result.payload || {},
      }));

      logger.debug('Context retrieved from vector DB', {
        action: 'vector_retrieve',
        tenant_id: tenantId,
        query_length: query.length,
        results_count: results.length,
      });

      return results;
    } catch (error) {
      logger.error('Failed to retrieve context', {
        action: 'vector_retrieve_error',
        tenant_id: tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete all context for a tenant
   * @param tenantId - Tenant identifier
   */
  async deleteContext(tenantId: string): Promise<void> {
    try {
      const collectionName = this.getCollectionName(tenantId);

      await this.qdrant.deleteCollection(collectionName);

      logger.info('Tenant context deleted', {
        action: 'vector_delete_collection',
        tenant_id: tenantId,
        collection: collectionName,
      });
    } catch (error) {
      logger.error('Failed to delete context', {
        action: 'vector_delete_error',
        tenant_id: tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Generate embedding using DeepSeek API
   * @param text - Text to embed
   * @returns Embedding vector
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY not configured');
    }

    try {
      const response = await axios.post(
        'https://api.deepseek.com/v1/embeddings',
        {
          model: 'deepseek-embed',
          input: text,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const embedding = response.data.data[0].embedding;

      if (!Array.isArray(embedding) || embedding.length !== this.embeddingDimension) {
        throw new Error(
          `Invalid embedding dimension: expected ${this.embeddingDimension}, got ${embedding?.length}`
        );
      }

      return embedding;
    } catch (error) {
      logger.error('Failed to generate embedding', {
        action: 'embedding_generation_error',
        text_length: text.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Ensure collection exists with proper configuration
   * @param collectionName - Collection name
   */
  private async ensureCollection(collectionName: string): Promise<void> {
    try {
      const collections = await this.qdrant.getCollections();
      const exists = collections.collections.some((c) => c.name === collectionName);

      if (!exists) {
        await this.qdrant.createCollection(collectionName, {
          vectors: {
            size: this.embeddingDimension,
            distance: 'Cosine',
          },
          optimizers_config: {
            default_segment_number: 2,
          },
          replication_factor: 1,
        });

        logger.info('Created new collection', {
          action: 'vector_create_collection',
          collection: collectionName,
        });
      }
    } catch (error) {
      logger.error('Failed to ensure collection', {
        action: 'vector_ensure_collection_error',
        collection: collectionName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get collection name for tenant
   * @param tenantId - Tenant identifier
   * @returns Collection name
   */
  private getCollectionName(tenantId: string): string {
    return `tenant_${tenantId}_context`;
  }

  /**
   * Get collection stats
   * @param tenantId - Tenant identifier
   */
  async getCollectionStats(tenantId: string): Promise<{
    pointsCount: number;
    segmentsCount: number;
  }> {
    try {
      const collectionName = this.getCollectionName(tenantId);
      const info = await this.qdrant.getCollection(collectionName);

      return {
        pointsCount: info.points_count || 0,
        segmentsCount: info.segments_count || 0,
      };
    } catch (error) {
      logger.error('Failed to get collection stats', {
        action: 'vector_stats_error',
        tenant_id: tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { pointsCount: 0, segmentsCount: 0 };
    }
  }
}
