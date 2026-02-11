# 🦞 DROID OpenClaw Brain - COMPLETE SETUP GUIDE

> **When you get home, follow this checklist. Total time: ~15 minutes**

---

## ✅ PRE-FLIGHT CHECKLIST

**Before you start:**
- [ ] DROID (Solana Saga) plugged into power
- [ ] WiFi connected
- [ ] USB cable connected to Mac (for initial setup)
- [ ] Termux app installed
- [ ] ~2GB free storage

---

## 🚀 PHASE 1: One-Command Setup (5 minutes)

### Step 1: Open Termux
1. Open Termux app on DROID
2. You should see a black terminal screen
3. Type the following and press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/0motionguy/claw-smm-stack/main/droid-complete-setup/install-openclaw-brain.sh | bash
```

**OR** if the above doesn't work, use local file:

```bash
cd /sdcard/smm-agent && bash install-openclaw-brain.sh
```

### Step 2: Wait for Installation
- This will take ~5 minutes
- You'll see progress messages
- **DO NOT close Termux during this**

---

## ⚙️ PHASE 2: Configuration (3 minutes)

### Step 3: Set Instagram Credentials

```bash
export IG_USERNAME="your_instagram_username"
export IG_PASSWORD="your_instagram_password"
```

**Make it permanent:**
```bash
echo 'export IG_USERNAME="your_username"' >> ~/.bashrc
echo 'export IG_PASSWORD="your_password"' >> ~/.bashrc
```

### Step 4: Set CLAW (Mac) IP Address

Find your Mac's IP:
```bash
# On Mac, run:
ipconfig getifaddr en0
```

Then on DROID:
```bash
export CLAW_IP="192.168.1.xxx"  # Replace with actual IP
echo 'export CLAW_IP="192.168.1.xxx"' >> ~/.bashrc
```

---

## 🤖 PHASE 3: Start Services (2 minutes)

### Step 5: Start SMM Agent

```bash
~/start-smm.sh
```

You should see:
```
🦞 Starting SMM Agent...
✅ Environment ready!
🚀 SMM Agent API listening on port 3000
```

### Step 6: Test from CLAW (Mac)

On your Mac, run:
```bash
# Check DROID status
curl http://<DROID_IP>:3000/status

# Or use the controller
./droid-smm-controller.sh status
```

---

## 🎯 PHASE 4: Verify Everything (5 minutes)

### Step 7: Run Quick Tests

**From Mac:**
```bash
# 1. Wake DROID
./droid-smm-controller.sh wake

# 2. Check Instagram is installed
./droid-smm-controller.sh instagram

# 3. Take a screenshot
./droid-smm-controller.sh screenshot

# 4. Check DROID status
./droid-smm-controller.sh status
```

**Expected results:**
- DROID wakes up
- Instagram opens
- Screenshot saved to Mac logs
- Status shows battery, storage, etc.

---

## 🔄 PHASE 5: Enable Auto-Start (Optional, 2 minutes)

### Step 8: Install Termux:Boot

1. Install "Termux:Boot" app from F-Droid
2. Open it once (creates necessary permissions)
3. Reboot DROID
4. SMM Agent will auto-start on boot

**Manual start if needed:**
```bash
~/start-smm.sh
```

---

## 🎉 YOU'RE DONE!

**DROID is now:**
- ✅ Running OpenClaw Brain
- ✅ Monitoring Instagram 24/7
- ✅ Connected to CLAW (Mac)
- ✅ Ready for SMM automation

---

## 📱 DROID COMMANDS REFERENCE

**In Termux:**
```bash
~/start-smm.sh              # Start SMM Agent
pkill -f smm-agent          # Stop SMM Agent
tail -f ~/smm-agent/smm-agent.log  # View logs
```

**From Mac:**
```bash
./droid-smm-controller.sh status      # Device status
./droid-smm-controller.sh wake        # Wake DROID
./droid-smm-controller.sh instagram   # Open Instagram
./droid-smm-controller.sh check       # Check notifications
./droid-smm-controller.sh screenshot  # Take screenshot
./droid-smm-controller.sh auto        # Start autonomous mode
```

---

## 🆘 TROUBLESHOOTING

**"Permission denied" errors:**
```bash
chmod +x ~/start-smm.sh
chmod +x ~/.termux/boot/start-smm
```

**"Command not found" for npm/node:**
```bash
source ~/.bashrc
```

**Can't connect from Mac to DROID:**
- Make sure both on same WiFi
- Check DROID IP: `ifconfig` in Termux
- Ping from Mac: `ping <DROID_IP>`

**SMM Agent won't start:**
```bash
cd ~/smm-agent
npm install
node smm-agent.js
```

**Instagram won't open:**
- Make sure Instagram app is installed
- Try: `adb shell "monkey -p com.instagram.android -c android.intent.category.LAUNCHER 1"`

---

## 🔐 SECURITY NOTES

- Keep DROID physically secure (it's your SMM Iron Man)
- Instagram credentials stored in ~/.bashrc (local only)
- Use strong Instagram password
- Enable 2FA on Instagram (you'll need to approve login once)
- Don't share DROID's IP address publicly

---

## 📊 WHAT HAPPENS NEXT

**Once running, DROID will:**
1. Check Instagram every 5 minutes
2. Auto-reply to praise comments
3. Draft replies for questions (send to you for approval)
4. Log all activity to CLAW
5. Run 24/7 (keep plugged in!)

**You'll get:**
- Hourly reports via Telegram
- Daily morning briefings
- Weekly analytics summaries
- Alerts for any issues

---

**Ready to start? Open Termux and run the setup command! 🚀**
