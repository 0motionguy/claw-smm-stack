const express = require('express');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(express.json());

const CONTROLLER = path.join(__dirname, 'droid-smm-controller.sh');
const DEVICE = 'O1E1XT232303000';

// Execute controller command
function execute(command, args = []) {
    return new Promise((resolve) => {
        const cmd = `${CONTROLLER} ${command} ${args.map(a => `"${a}"`).join(' ')}`;
        exec(cmd, (error, stdout, stderr) => {
            resolve({
                success: !error,
                stdout: stdout.toString(),
                stderr: stderr.toString(),
                command: cmd
            });
        });
    });
}

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        device: DEVICE,
        timestamp: new Date().toISOString()
    });
});

// Device status
app.get('/status', async (req, res) => {
    const result = await execute('status');
    res.json(result);
});

// Wake device
app.post('/wake', async (req, res) => {
    const result = await execute('wake');
    res.json(result);
});

// Open Instagram
app.post('/instagram', async (req, res) => {
    const result = await execute('instagram');
    res.json(result);
});

// Take screenshot
app.post('/screenshot', async (req, res) => {
    const result = await execute('screenshot');
    res.json(result);
});

// Check notifications
app.post('/check', async (req, res) => {
    const result = await execute('check');
    res.json(result);
});

// Reply to comment
app.post('/reply', async (req, res) => {
    const { text } = req.body;
    if (!text) {
        return res.status(400).json({ error: 'text required' });
    }
    const result = await execute('reply', [text]);
    res.json(result);
});

// Post content
app.post('/post', async (req, res) => {
    const { caption } = req.body;
    if (!caption) {
        return res.status(400).json({ error: 'caption required' });
    }
    const result = await execute('post', [caption]);
    res.json(result);
});

// Get recent screenshots
app.get('/screenshots', (req, res) => {
    const fs = require('fs');
    const logsDir = '/Users/andy/.openclaw/workspace/logs';
    
    fs.readdir(logsDir, (err, files) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const screenshots = files
            .filter(f => f.startsWith('droid-') && f.endsWith('.png'))
            .sort()
            .reverse()
            .slice(0, 10);
        
        res.json({ screenshots });
    });
});

// Start autonomous mode
app.post('/auto', async (req, res) => {
    // This runs in background
    const { spawn } = require('child_process');
    const child = spawn(CONTROLLER, ['auto'], { detached: true });
    
    res.json({ 
        status: 'autonomous mode started',
        pid: child.pid
    });
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
    console.log(`🦞 DROID SMM Bridge listening on port ${PORT}`);
    console.log(`Device: ${DEVICE}`);
    console.log('');
    console.log('Endpoints:');
    console.log('  GET  /health       - Health check');
    console.log('  GET  /status       - Device status');
    console.log('  POST /wake         - Wake device');
    console.log('  POST /instagram    - Open Instagram');
    console.log('  POST /screenshot   - Take screenshot');
    console.log('  POST /check        - Check notifications');
    console.log('  POST /reply        - Reply to comment');
    console.log('  POST /post         - Post content');
    console.log('  POST /auto         - Start autonomous mode');
});

module.exports = app;
