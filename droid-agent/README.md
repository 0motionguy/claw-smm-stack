# 🦞 DROID SMM Agent

Your Solana Mobile Saga is now an autonomous Instagram Social Media Manager!

## What It Does

- ✅ Monitors Instagram notifications every 5 minutes
- ✅ Auto-replies to praise comments
- ✅ Drafts replies for questions (needs approval)
- ✅ Runs 24/7 on your mobile device
- ✅ Mobile IP = less bot detection
- ✅ Native Instagram app = harder to detect

## Setup

### 1. Install Dependencies (in Termux)
```bash
cd ~/smm-agent
bash install.sh
```

### 2. Configure Instagram
```bash
export IG_USERNAME=your_username
export IG_PASSWORD=your_password
```

Or edit `config.json`:
```json
{
  "instagram": {
    "username": "your_username",
    "password": "your_password"
  }
}
```

### 3. Start the Agent
```bash
npm start
```

## API Endpoints

- `GET http://localhost:3000/status` - Check agent status
- `POST http://localhost:3000/start` - Start monitoring
- `POST http://localhost:3000/stop` - Stop monitoring
- `POST http://localhost:3000/config` - Update config

## From Mac/CLAW

Control DROID via:
```bash
# Check status
curl http://<droid-ip>:3000/status

# Start agent
curl -X POST http://<droid-ip>:3000/start
```

## Autostart on Boot

Add to `~/.bashrc`:
```bash
cd ~/smm-agent && npm start &
```

## Logs

View logs:
```bash
tail -f ~/smm-agent/smm-agent.log
```

## Safety

- Max 20 comments per session (rate limiting)
- 5-minute check intervals
- Circuit breaker on errors
- Manual approval for sensitive replies

---
**Your DROID is now your SMM Iron Man! 🤖**
