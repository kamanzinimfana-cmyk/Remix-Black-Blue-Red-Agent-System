// 🛸 FLOATING DRAGGABLE UI FOR CHROME EXTENSION
(function() {
  if (window.hasFloatingUI) return;
  window.hasFloatingUI = true;

  const container = document.createElement('div');
  container.id = 'blue-red-floating-ui';
  container.innerHTML = `
    <div id="blue-red-header">
      <span class="logo">🧠</span>
      <span class="title">Blue & Red Agent</span>
      <button id="blue-red-minimize">_</button>
    </div>
    <div id="blue-red-body">
      <textarea id="blue-red-task" placeholder="What should I do on this page?"></textarea>
      <div class="blue-red-controls">
        <button id="blue-red-run">▶ Run Task</button>
        <button id="blue-red-stop">⏹ Stop</button>
      </div>
      <div id="blue-red-status">Status: Idle</div>
      <div id="blue-red-logs"></div>
    </div>
  `;

  document.body.appendChild(container);

  // 🎨 STYLES (Injected directly for simplicity)
  const style = document.createElement('style');
  style.textContent = `
    #blue-red-floating-ui {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 300px;
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
      z-index: 9999999;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: height 0.3s ease;
    }

    #blue-red-header {
      padding: 10px 15px;
      background: #1e293b;
      cursor: move;
      display: flex;
      align-items: center;
      gap: 10px;
      user-select: none;
    }

    #blue-red-header .logo { font-size: 18px; }
    #blue-red-header .title { font-size: 13px; font-weight: 600; flex: 1; }
    #blue-red-header button { 
      background: none; border: none; color: #64748b; cursor: pointer; font-size: 16px; 
    }
    #blue-red-header button:hover { color: white; }

    #blue-red-body { padding: 15px; display: flex; flex-direction: column; gap: 10px; }
    #blue-red-body.minimized { display: none; }

    #blue-red-task {
      width: 100%;
      height: 80px;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      color: white;
      padding: 10px;
      font-size: 12px;
      resize: none;
      outline: none;
    }
    #blue-red-task:focus { border-color: #3b82f6; }

    .blue-red-controls { display: flex; gap: 8px; }
    .blue-red-controls button {
      flex: 1;
      padding: 8px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    #blue-red-run { background: #2563eb; color: white; }
    #blue-red-stop { background: #334155; color: white; }
    .blue-red-controls button:hover { opacity: 0.9; }

    #blue-red-status { font-size: 11px; color: #94a3b8; }
    #blue-red-logs {
      max-height: 100px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 10px;
      background: #000;
      padding: 8px;
      border-radius: 4px;
      color: #cbd5e1;
      display: none;
    }
    #blue-red-logs.active { display: block; }
  `;
  document.head.appendChild(style);

  // 🖱️ DRAGGABLE LOGIC
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;

  const header = document.getElementById('blue-red-header');

  header.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);

  function dragStart(e) {
    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;
    if (e.target === header || header.contains(e.target)) {
      isDragging = true;
    }
  }

  function drag(e) {
    if (isDragging) {
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      xOffset = currentX;
      yOffset = currentY;
      setTranslate(currentX, currentY, container);
    }
  }

  function setTranslate(xPos, yPos, el) {
    el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
  }

  function dragEnd() {
    initialX = currentX;
    initialY = currentY;
    isDragging = false;
  }

  // 📉 MINIMIZE LOGIC
  const minimizeBtn = document.getElementById('blue-red-minimize');
  const body = document.getElementById('blue-red-body');
  minimizeBtn.addEventListener('click', () => {
    body.classList.toggle('minimized');
    minimizeBtn.textContent = body.classList.contains('minimized') ? '+' : '_';
  });

  // 🚀 TASK LOGIC
  const runBtn = document.getElementById('blue-red-run');
  const stopBtn = document.getElementById('blue-red-stop');
  const taskInput = document.getElementById('blue-red-task');
  const statusEl = document.getElementById('blue-red-status');
  const logsEl = document.getElementById('blue-red-logs');

  function addLog(msg) {
    logsEl.classList.add('active');
    const entry = document.createElement('div');
    entry.textContent = `> ${msg}`;
    logsEl.appendChild(entry);
    logsEl.scrollTop = logsEl.scrollHeight;
  }

  runBtn.addEventListener('click', () => {
    const task = taskInput.value.trim();
    if (!task) return;

    statusEl.textContent = 'Status: Running...';
    addLog(`Starting task: ${task}`);
    
    chrome.runtime.sendMessage({ 
      type: "START_TASK", 
      task: task,
      settings: {
        agentType: "orchestrator",
        aiMode: "auto",
        speedMode: "fast",
        stealthEnabled: true
      }
    });
  });

  stopBtn.addEventListener('click', () => {
    statusEl.textContent = 'Status: Stopped';
    addLog('Task stopped.');
    chrome.runtime.sendMessage({ type: "STOP_TASK" });
  });

  // Listen for status updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TASK_STATUS") {
      statusEl.textContent = `Status: ${msg.status}`;
      if (msg.log) addLog(msg.log);
    }
  });

})();
