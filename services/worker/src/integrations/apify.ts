import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { logger } from '../utils/logger';

/**
 * Apify client for competitor monitoring and Instagram scraping
 */

// Zod schemas for Apify responses
const ProfileDataSchema = z.object({
  username: z.string(),
  fullName: z.string().optional(),
  biography: z.string().optional(),
  followersCount: z.number(),
  followsCount: z.number(),
  postsCount: z.number(),
  isVerified: z.boolean().optional(),
  isBusinessAccount: z.boolean().optional(),
  profilePicUrl: z.string().optional(),
  externalUrl: z.string().optional(),
});

const PostSchema = z.object({
  id: z.string(),
  shortCode: z.string(),
  caption: z.string().optional(),
  timestamp: z.string(),
  likesCount: z.number(),
  commentsCount: z.number(),
  displayUrl: z.string(),
  videoUrl: z.string().optional(),
  isVideo: z.boolean(),
});

const HashtagDataSchema = z.object({
  hashtag: z.string(),
  postsCount: z.number(),
  topPosts: z.array(PostSchema),
});

export type ProfileData = z.infer<typeof ProfileDataSchema>;
export type HashtagData = z.infer<typeof HashtagDataSchema>;
export type Post = z.infer<typeof PostSchema>;

export class ApifyClient {
  private readonly client: AxiosInstance;
  private readonly apiToken: string;

  constructor() {
    this.apiToken = process.env.APIFY_API_TOKEN || '';
    if (!this.apiToken) {
      logger.warn('APIFY_API_TOKEN not configured', {
        action: 'apify_init_warning',
      });
    }

    this.client = axios.create({
      baseURL: 'https://api.apify.com/v2',
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Scrape Instagram profile data
   * @param igHandle - Instagram username (without @)
   * @returns Profile data
   */
  async scrapeProfile(igHandle: string): Promise<ProfileData> {
    try {
      logger.info('Scraping Instagram profile', {
        action: 'apify_scrape_profile',
        ig_handle: igHandle,
      });

      // Use Instagram Profile Scraper actor
      const actorId = 'apify/instagram-profile-scraper';

      // Start actor run
      const runResponse = await this.client.post(
        `/acts/${actorId}/runs`,
        {
          usernames: [igHandle],
          resultsLimit: 1,
        },
        {
          params: {
            token: this.apiToken,
          },
        }
      );

      const runId = runResponse.data.data.id;

      // Wait for run to complete
      const result = await this.waitForRun(runId);

      // Get dataset items
      const datasetId = result.defaultDatasetId;
      const itemsResponse = await this.client.get(
        `/datasets/${datasetId}/items`,
        {
          params: {
            token: this.apiToken,
          },
        }
      );

      const items = itemsResponse.data;
      if (!items || items.length === 0) {
        throw new Error(`No data found for Instagram handle: ${igHandle}`);
      }

      const rawData = items[0];

      // Map Apify response to our schema
      const profileData: ProfileData = {
        username: rawData.username || igHandle,
        fullName: rawData.fullName,
        biography: rawData.biography,
        followersCount: rawData.followersCount || 0,
        followsCount: rawData.followsCount || 0,
        postsCount: rawData.postsCount || 0,
        isVerified: rawData.verified,
        isBusinessAccount: rawData.isBusinessAccount,
        profilePicUrl: rawData.profilePicUrl,
        externalUrl: rawData.externalUrl,
      };

      const validated = ProfileDataSchema.parse(profileData);

      logger.info('Profile scraped successfully', {
        action: 'apify_scrape_profile_success',
        ig_handle: igHandle,
        followers: validated.followersCount,
      });

      return validated;
    } catch (error) {
      logger.error('Failed to scrape Instagram profile', {
        action: 'apify_scrape_profile_error',
        ig_handle: igHandle,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Scrape hashtag top posts
   * @param hashtag - Hashtag (without #)
   * @returns Hashtag data with top posts
   */
  async scrapeHashtag(hashtag: string): Promise<HashtagData> {
    try {
      logger.info('Scraping Instagram hashtag', {
        action: 'apify_scrape_hashtag',
        hashtag,
      });

      // Use Instagram Hashtag Scraper actor
      const actorId = 'apify/instagram-hashtag-scraper';

      // Start actor run
      const runResponse = await this.client.post(
        `/acts/${actorId}/runs`,
        {
          hashtags: [hashtag],
          resultsLimit: 20, // Top 20 posts
        },
        {
          params: {
            token: this.apiToken,
          },
        }
      );

      const runId = runResponse.data.data.id;

      // Wait for run to complete
      const result = await this.waitForRun(runId);

      // Get dataset items
      const datasetId = result.defaultDatasetId;
      const itemsResponse = await this.client.get(
        `/datasets/${datasetId}/items`,
        {
          params: {
            token: this.apiToken,
          },
        }
      );

      const items = itemsResponse.data || [];

      // Map posts
      const topPosts: Post[] = items.map((item: any) => ({
        id: item.id,
        shortCode: item.shortCode,
        caption: item.caption,
        timestamp: item.timestamp,
        likesCount: item.likesCount || 0,
        commentsCount: item.commentsCount || 0,
        displayUrl: item.displayUrl,
        videoUrl: item.videoUrl,
        isVideo: item.isVideo || false,
      }));

      const hashtagData: HashtagData = {
        hashtag,
        postsCount: topPosts.length,
        topPosts,
      };

      const validated = HashtagDataSchema.parse(hashtagData);

      logger.info('Hashtag scraped successfully', {
        action: 'apify_scrape_hashtag_success',
        hashtag,
        posts_count: validated.topPosts.length,
      });

      return validated;
    } catch (error) {
      logger.error('Failed to scrape Instagram hashtag', {
        action: 'apify_scrape_hashtag_error',
        hashtag,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Wait for Apify actor run to complete
   * @param runId - Run ID
   * @returns Run result
   */
  private async waitForRun(runId: string, maxWaitMs: number = 120000): Promise<any> {
    const startTime = Date.now();
    const pollInterval = 3000; // 3 seconds

    while (Date.now() - startTime < maxWaitMs) {
      const statusResponse = await this.client.get(`/actor-runs/${runId}`, {
        params: {
          token: this.apiToken,
        },
      });

      const status = statusResponse.data.data.status;

      if (status === 'SUCCEEDED') {
        return statusResponse.data.data;
      }

      if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
        throw new Error(`Apify run ${status.toLowerCase()}: ${runId}`);
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Apify run timeout: ${runId}`);
  }

  /**
   * Get account run history
   * @param limit - Maximum number of runs to return
   */
  async getRunHistory(limit: number = 10): Promise<any[]> {
    try {
      const response = await this.client.get('/actor-runs', {
        params: {
          token: this.apiToken,
          limit,
        },
      });

      return response.data.data.items || [];
    } catch (error) {
      logger.error('Failed to get run history', {
        action: 'apify_get_runs_error',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Check if Apify is configured and accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/users/me', {
        params: {
          token: this.apiToken,
        },
      });

      return response.status === 200;
    } catch (error) {
      logger.error('Apify health check failed', {
        action: 'apify_health_check_error',
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
