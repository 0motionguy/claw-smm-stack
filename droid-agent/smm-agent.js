const puppeteer = require('puppeteer-core');
const express = require('express');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  // Instagram credentials (will be set via environment or config file)
  instagram: {
    username: process.env.IG_USERNAME || '',
    password: process.env.IG_PASSWORD || '',
  },
  // Automation settings
  settings: {
    checkInterval: 5 * 60 * 1000, // 5 minutes
    maxCommentsPerSession: 20,
    replyTemplates: {
      praise: ['Thank you! 🙏', 'So glad you liked it! ❤️', 'Appreciate you! 🙌'],
      question: ['Great question! Let me check...', 'Thanks for asking!'],
    }
  }
};

// State management
const state = {
  isRunning: false,
  lastCheck: null,
  commentsReplied: 0,
  sessionStart: null,
};

// Logger
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message, ...data };
  console.log(JSON.stringify(entry));
  
  // Also write to file
  const logFile = path.join(__dirname, 'smm-agent.log');
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
}

// Instagram Browser Automation
class InstagramAgent {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async init() {
    log('info', 'Initializing Instagram agent...');
    
    // Connect to Chrome on Android (if available) or use WebView
    try {
      this.browser = await puppeteer.connect({
        browserURL: 'http://localhost:9222', // Chrome DevTools Protocol
        defaultViewport: { width: 1080, height: 2400 }
      });
      this.page = (await this.browser.pages())[0];
      log('info', 'Connected to Chrome');
    } catch (e) {
      log('warn', 'Could not connect to Chrome, will use fallback', { error: e.message });
      // Fallback: Use ADB-based automation
      return false;
    }
    
    return true;
  }

  async login() {
    if (!CONFIG.instagram.username || !CONFIG.instagram.password) {
      log('error', 'Instagram credentials not configured');
      return false;
    }

    try {
      await this.page.goto('https://www.instagram.com/accounts/login/');
      await this.page.waitForSelector('input[name="username"]', { timeout: 10000 });
      
      await this.page.type('input[name="username"]', CONFIG.instagram.username);
      await this.page.type('input[name="password"]', CONFIG.instagram.password);
      
      await this.page.click('button[type="submit"]');
      await this.page.waitForNavigation({ waitUntil: 'networkidle2' });
      
      // Check for 2FA or success
      const currentUrl = this.page.url();
      if (currentUrl.includes('two_factor') || currentUrl.includes('challenge')) {
        log('warn', '2FA or challenge required');
        return false;
      }
      
      log('info', 'Logged in successfully');
      return true;
    } catch (e) {
      log('error', 'Login failed', { error: e.message });
      return false;
    }
  }

  async checkNotifications() {
    try {
      // Navigate to notifications
      await this.page.goto('https://www.instagram.com/accounts/activity/');
      await this.page.waitForTimeout(3000);
      
      // Look for comment notifications
      const comments = await this.page.evaluate(() => {
        const elements = document.querySelectorAll('[role="button"]');
        return Array.from(elements)
          .filter(el => el.textContent.includes('commented'))
          .map(el => ({
            text: el.textContent,
            href: el.closest('a')?.href
          }));
      });
      
      log('info', 'Found notifications', { count: comments.length });
      return comments;
    } catch (e) {
      log('error', 'Failed to check notifications', { error: e.message });
      return [];
    }
  }

  async replyToComment(postUrl, replyText) {
    try {
      await this.page.goto(postUrl);
      await this.page.waitForTimeout(2000);
      
      // Find comment input
      const input = await this.page.$('textarea[placeholder*="Add a comment"]');
      if (input) {
        await input.type(replyText);
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(1000);
        
        state.commentsReplied++;
        log('info', 'Replied to comment', { postUrl, replyText });
        return true;
      }
    } catch (e) {
      log('error', 'Failed to reply', { error: e.message });
    }
    return false;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

// ADB-based automation (fallback for Android)
class ADBAgent {
  async tap(x, y) {
    const { exec } = require('child_process');
    return new Promise((resolve) => {
      exec(`input tap ${x} ${y}`, () => resolve());
    });
  }

  async swipe(x1, y1, x2, y2) {
    const { exec } = require('child_process');
    return new Promise((resolve) => {
      exec(`input swipe ${x1} ${y1} ${x2} ${y2}`, () => resolve());
    });
  }

  async type(text) {
    const { exec } = require('child_process');
    return new Promise((resolve) => {
      exec(`input text "${text.replace(/ /g, '%s')}"`, () => resolve());
    });
  }

  async screenshot() {
    const { exec } = require('child_process');
    return new Promise((resolve) => {
      exec('screencap -p /sdcard/smm-screenshot.png', () => {
        resolve('/sdcard/smm-screenshot.png');
      });
    });
  }
}

// Main agent loop
class SMMAgent {
  constructor() {
    this.instagram = new InstagramAgent();
    this.adb = new ADBAgent();
    this.running = false;
  }

  async start() {
    log('info', 'Starting SMM Agent...');
    state.isRunning = true;
    state.sessionStart = new Date().toISOString();

    // Try to initialize Instagram
    const chromeAvailable = await this.instagram.init();
    
    if (chromeAvailable) {
      const loggedIn = await this.instagram.login();
      if (!loggedIn) {
        log('warn', 'Could not log in automatically, using ADB mode');
      }
    }

    // Start monitoring loop
    this.running = true;
    this.monitor();
  }

  async monitor() {
    while (this.running) {
      try {
        log('info', 'Checking for new activity...');
        
        // Check notifications
        if (this.instagram.page) {
          const notifications = await this.instagram.checkNotifications();
          
          for (const notification of notifications.slice(0, CONFIG.settings.maxCommentsPerSession)) {
            // Classify and respond
            const reply = this.generateReply(notification.text);
            if (reply) {
              await this.instagram.replyToComment(notification.href, reply);
            }
          }
        }
        
        state.lastCheck = new Date().toISOString();
        
        // Wait before next check
        await this.sleep(CONFIG.settings.checkInterval);
        
      } catch (e) {
        log('error', 'Monitor error', { error: e.message });
        await this.sleep(60000); // Wait 1 min on error
      }
    }
  }

  generateReply(commentText) {
    // Simple classification
    const text = commentText.toLowerCase();
    
    if (text.includes('love') || text.includes('great') || text.includes('awesome')) {
      const templates = CONFIG.settings.replyTemplates.praise;
      return templates[Math.floor(Math.random() * templates.length)];
    }
    
    if (text.includes('?') || text.includes('how') || text.includes('what')) {
      const templates = CONFIG.settings.replyTemplates.question;
      return templates[Math.floor(Math.random() * templates.length)];
    }
    
    return 'Thanks for your comment! 👍';
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    this.running = false;
    state.isRunning = false;
    this.instagram.close();
    log('info', 'SMM Agent stopped');
  }

  getStatus() {
    return {
      ...state,
      uptime: state.sessionStart ? Date.now() - new Date(state.sessionStart).getTime() : 0,
    };
  }
}

// Express API for remote control
const app = express();
app.use(express.json());

const agent = new SMMAgent();

app.get('/status', (req, res) => {
  res.json(agent.getStatus());
});

app.post('/start', (req, res) => {
  agent.start();
  res.json({ status: 'started' });
});

app.post('/stop', (req, res) => {
  agent.stop();
  res.json({ status: 'stopped' });
});

app.post('/config', (req, res) => {
  const { username, password } = req.body;
  if (username) CONFIG.instagram.username = username;
  if (password) CONFIG.instagram.password = password;
  res.json({ status: 'config updated' });
});

// Start API server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  log('info', `SMM Agent API listening on port ${PORT}`);
});

// Auto-start if credentials are set
if (CONFIG.instagram.username && CONFIG.instagram.password) {
  setTimeout(() => agent.start(), 5000);
}

module.exports = { SMMAgent, InstagramAgent };
