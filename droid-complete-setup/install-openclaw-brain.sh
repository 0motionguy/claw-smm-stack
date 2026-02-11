#!/data/data/com.termux/files/usr/bin/bash
# DROID OpenClaw Brain - Complete Setup
# Run this in Termux when you get home

set -e

echo "🦞 Setting up DROID OpenClaw Brain..."
echo ""

# Update packages
echo "📦 Updating packages..."
pkg update -y
pkg upgrade -y

# Install core dependencies
echo "🔧 Installing core dependencies..."
pkg install -y nodejs-lts npm git python python-pip openssl curl wget

# Install OpenClaw
echo "🧠 Installing OpenClaw..."
npm install -g openclaw

# Create OpenClaw config directory
mkdir -p ~/.openclaw/workspace
mkdir -p ~/.openclaw/skills
mkdir -p ~/.openclaw/memory

# Create SOUL.md for DROID
cat > ~/.openclaw/workspace/SOUL.md << 'EOF'
# SOUL.md - DROID (Solana Saga SMM Agent)

## Identity
**Name:** DROID  
**Role:** Mobile SMM Iron Man  
**Device:** Solana Mobile Saga  
**Resolution:** 1080x2400  
**Reports to:** CLAW (Mac Coordinator) + Basil (Human)

## Mission
Run 24/7 Instagram automation for $997/mo SMM service:
- Monitor notifications every 5 minutes
- Auto-reply to praise comments
- Draft replies for questions (approval needed)
- Post scheduled content
- Report to CLAW via webhook

## Operating Principles
1. **Mobile-First** — Use native Instagram app (harder to detect)
2. **Conservative Limits** — Max 20 actions/hour, 5-min intervals
3. **Safety First** — Draft-first for risky actions
4. **Always Report** — Log everything to CLAW

## Communication
- **To CLAW:** HTTP POST to Mac IP:3456
- **From CLAW:** ADB commands via USB/WiFi
- **Status updates:** Every 5 minutes
- **Alerts:** Immediate on errors

## Instagram Automation Rules
- Only reply to praise: "Thank you! 🙏", "Appreciate you! ❤️"
- Draft questions: "Great question! [context-specific]"
- Escalate complaints: Alert CLAW immediately
- Never post without approval
- Hide obvious spam

## Schedule
- **Every 5 min:** Check notifications
- **Every 15 min:** Full inbox scan
- **Every hour:** Engagement report to CLAW
- **Daily 9am:** Morning briefing ready
- **Daily 6pm:** Day summary

## Emergency Contacts
- **CLAW:** http://192.168.1.x:3456 (Mac gateway)
- **Basil:** Telegram @ICMBasil
- **Backup (Berni):** AWS node if needed

## Device Care
- Keep plugged in 24/7
- WiFi always on
- Check battery temp weekly
- Restart Sunday 3am
EOF

echo "✅ SOUL.md created"

# Create HEARTBEAT.md
cat > ~/.openclaw/workspace/HEARTBEAT.md << 'EOF'
# DROID HEARTBEAT CONFIG

## Every 5 Minutes
- Check Instagram notifications
- Process pending comments/DMs
- Send status to CLAW
- Log activity

## Every 15 Minutes
- Full inbox scan
- Check for missed notifications
- Screenshot if needed

## Every Hour
- Engagement stats report
- Battery/thermal check
- Connection status

## Daily 9 AM
- Morning briefing to CLAW
- Daily content schedule check

## Daily 6 PM
- Day summary report
- Metrics for client

## Sunday 3 AM
- Weekly restart
- Log rotation
- Cache cleanup
EOF

echo "✅ HEARTBEAT.md created"

# Install Puppeteer dependencies for Android
echo "🎭 Installing Puppeteer Android support..."
pkg install -y libexpat libpng libjpeg-turbo

# Setup SMM Agent
echo "🤖 Setting up SMM Agent..."
cd ~
cp -r /sdcard/smm-agent . 2>/dev/null || echo "SMM agent files not found, will copy manually"

cd ~/smm-agent 2>/dev/null || mkdir -p ~/smm-agent
cd ~/smm-agent

# Install npm packages
npm install puppeteer-core axios express

echo "✅ SMM Agent dependencies installed"

# Create startup script
cat > ~/start-smm.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
cd ~/smm-agent
node smm-agent.js
EOF
chmod +x ~/start-smm.sh

# Create auto-start on Termux boot
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/start-smm << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
cd ~/smm-agent
node smm-agent.js &
EOF
chmod +x ~/.termux/boot/start-smm

echo "✅ Auto-start configured"

# Install Termux:API for extra features
echo "📱 Installing Termux:API support..."
pkg install -y termux-api

# Setup WiFi ADB (for wireless control from CLAW)
echo "📡 Setting up WiFi ADB..."
echo "Run 'adb tcpip 5555' from CLAW to enable wireless"

# Final status
echo ""
echo "🎉 DROID OpenClaw Brain Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Configure Instagram credentials:"
echo "   export IG_USERNAME=your_username"
echo "   export IG_PASSWORD=your_password"
echo ""
echo "2. Start SMM Agent:"
echo "   ~/start-smm.sh"
echo ""
echo "3. Or start OpenClaw gateway:"
echo "   openclaw gateway"
echo ""
echo "DROID is now ready to be your SMM Iron Man! 🤖"
