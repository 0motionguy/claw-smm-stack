#!/data/data/com.termux/files/usr/bin/bash
# DROID SMM Agent - Setup Script
# Run this in Termux to set up the Instagram automation agent

echo "🦞 Setting up DROID SMM Agent..."

# Update packages
pkg update -y

# Install required packages
pkg install -y nodejs git python

# Create working directory
mkdir -p ~/smm-agent
cd ~/smm-agent

# Initialize npm project
npm init -y

# Install dependencies
npm install puppeteer-core axios express

echo "✅ Environment ready!"
echo "Next: Copy config from /sdcard/smm-agent-setup/"
