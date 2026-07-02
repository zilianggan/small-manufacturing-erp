const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

let serverProcess = null;
let mainWindow = null;

function startBackend() {
  const isDev = !app.isPackaged;

  if (isDev) {
    serverProcess = spawn('npx', ['tsx', 'server.ts'], {
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: true }
    });

    // Handle server process exit
    serverProcess.on('exit', (code) => {
      console.log(`Backend process exited with code ${code}`);
      if (code !== 0 && code !== null) {
        app.quit();
      }
    });
  } else {
    try {
      process.env.NODE_ENV = 'production';
      require(path.join(__dirname, 'dist/server.cjs'));
    } catch (err) {
      console.error('Failed to load production backend:', err);
      app.quit();
    }
  }
}

function pollServer(url, callback) {
  const req = http.get(url, (res) => {
    if (res.statusCode === 200) {
      callback();
    } else {
      setTimeout(() => pollServer(url, callback), 100);
    }
  });
  req.on('error', () => {
    setTimeout(() => pollServer(url, callback), 100);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    frame: true,
    icon: path.join(__dirname, "../assets/icon.png"),
    title: "Seng Jie Engineering ERP System",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });
  // mainWindow.loadFile("index.html")

  const url = 'http://localhost:3000';

  // Wait for the backend server to be ready before loading
  pollServer(`${url}/api/health`, () => {
    mainWindow.loadURL(url);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (serverProcess) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', serverProcess.pid, '/f', '/t'], { stdio: 'ignore' });
    } else {
      serverProcess.kill();
    }
  }
});
