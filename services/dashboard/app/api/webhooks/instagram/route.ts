import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'redis';

// Redis client setup
let redisClient: ReturnType<typeof createClient> | null = null;

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 2000),
      },
    });

    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    await redisClient.connect();
  }
  return redisClient;
}

// GET /api/webhooks/instagram - Meta webhook verification
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    // Verify token from environment variable
    const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'claw_smm_verify_token_12345';

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verification successful');
      return new NextResponse(challenge, { status: 200 });
    } else {
      console.error('Webhook verification failed', { mode, token });
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: 403 }
      );
    }
  } catch (error) {
    console.error('GET /api/webhooks/instagram error:', error);
    return NextResponse.json(
      { error: 'Webhook verification error' },
      { status: 500 }
    );
  }
}

// POST /api/webhooks/instagram - Instagram webhook events
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    console.log('Instagram webhook received:', JSON.stringify(body, null, 2));

    // Validate webhook signature (Meta requires this in production)
    const signature = request.headers.get('x-hub-signature-256');
    if (!signature) {
      console.warn('Missing webhook signature');
      // In development, we may skip signature validation
      // In production, you MUST validate: verifyWebhookSignature(body, signature)
    }

    // Process webhook payload
    if (body.object === 'instagram') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          await processWebhookChange(change);
        }
      }
    }

    // Meta requires fast 200 response (< 5 seconds)
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('POST /api/webhooks/instagram error:', error);
    // Still return 200 to Meta to avoid webhook being disabled
    return NextResponse.json({ success: true }, { status: 200 });
  }
}

async function processWebhookChange(change: any) {
  try {
    const { field, value } = change;

    console.log(`Processing webhook change: ${field}`);

    // Get Redis client
    const redis = await getRedisClient();

    // Create job payload
    const job = {
      type: field, // e.g., 'comments', 'messages', 'mentions'
      data: value,
      receivedAt: new Date().toISOString(),
    };

    // Push to Redis queue for background processing
    const queueKey = `webhook:queue:${field}`;
    await redis.rPush(queueKey, JSON.stringify(job));

    console.log(`Queued webhook job to ${queueKey}`);

    // Handle different webhook types
    switch (field) {
      case 'comments':
        await handleCommentWebhook(value, redis);
        break;
      case 'messages':
        await handleMessageWebhook(value, redis);
        break;
      case 'mentions':
        await handleMentionWebhook(value, redis);
        break;
      default:
        console.log(`Unhandled webhook field: ${field}`);
    }
  } catch (error) {
    console.error('Error processing webhook change:', error);
    // Don't throw - we want to return 200 to Meta
  }
}

async function handleCommentWebhook(value: any, redis: any) {
  // Queue comment for AI processing
  const commentData = {
    commentId: value.id,
    text: value.text,
    from: value.from,
    timestamp: value.timestamp,
  };

  await redis.rPush('ai:comments:pending', JSON.stringify(commentData));
  console.log('Comment queued for AI processing:', commentData.commentId);
}

async function handleMessageWebhook(value: any, redis: any) {
  // Queue DM for AI processing
  const dmData = {
    messageId: value.id,
    text: value.message?.text,
    from: value.from,
    timestamp: value.timestamp,
  };

  await redis.rPush('ai:dms:pending', JSON.stringify(dmData));
  console.log('DM queued for AI processing:', dmData.messageId);
}

async function handleMentionWebhook(value: any, redis: any) {
  // Queue mention for processing
  const mentionData = {
    mentionId: value.id,
    mediaId: value.media_id,
    from: value.from,
    timestamp: value.timestamp,
  };

  await redis.rPush('ai:mentions:pending', JSON.stringify(mentionData));
  console.log('Mention queued for processing:', mentionData.mentionId);
}

// Helper function to verify webhook signature (implement in production)
function verifyWebhookSignature(body: any, signature: string): boolean {
  // TODO: Implement signature verification using APP_SECRET
  // const crypto = require('crypto');
  // const hmac = crypto.createHmac('sha256', process.env.META_APP_SECRET);
  // const expectedSignature = 'sha256=' + hmac.update(JSON.stringify(body)).digest('hex');
  // return signature === expectedSignature;
  return true;
}
