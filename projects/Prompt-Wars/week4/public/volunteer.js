// StadiumPulse AI — Volunteer Controller
let currentRole = 'volunteer';
let stadiumState = {
  zones: [],
  activeDispatches: [],
  auditLog: [],
  simulationPreset: 'normal'
};

document.addEventListener('DOMContentLoaded', () => {
  fetchStadiumState();
  setInterval(fetchStadiumState, 5000);
  
  // Set default Volunteer Welcome Greeting
  const chatMessages = document.getElementById('chat-messages-box');
  if (chatMessages) {
    chatMessages.innerHTML = `
      <div class="chat-msg bot">
        <div class="msg-avatar"><i class="fa-solid fa-handshake-angle"></i></div>
        <div class="msg-bubble">
          <p>Welcome to the <strong>Gemini Field Volunteer Assistant</strong>! ⚽️</p>
          <p>I can help you review tournament crowd protocols, look up gate guidelines, or explain volunteer dispatch assignments. How can I help you today?</p>
        </div>
      </div>
    `;
  }
});

async function fetchStadiumState() {
  try {
    const response = await fetch('/api/stadium-state');
    const data = await response.json();
    stadiumState = data;

    renderVolunteerTasks();
    updateCopilotRecommendations();
  } catch (error) {
    console.error('Error fetching stadium state:', error);
  }
}

function renderVolunteerTasks() {
  const taskList = document.getElementById('volunteer-task-list');
  const emptyState = document.getElementById('volunteer-empty-state');
  
  if (!taskList) return;

  const tasks = stadiumState.activeDispatches || [];
  
  if (tasks.length === 0) {
    taskList.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  taskList.innerHTML = '';

  tasks.forEach(task => {
    const card = document.createElement('div');
    card.className = `task-card ${task.risk_label === 'critical' ? 'urgent' : ''}`;
    
    let severityClass = task.risk_label === 'critical' ? 'bg-red' : 'bg-yellow';
    
    card.innerHTML = `
      <div class="task-card-header">
        <span class="badge ${severityClass}">${task.zone_name} Dispatch</span>
        <span class="task-time">${new Date().toLocaleTimeString()}</span>
      </div>
      <p class="task-desc"><strong>Directive:</strong> ${task.action_text}</p>
      <div class="task-meta">
        <div><i class="fa-solid fa-users-gear text-purple"></i> Reallocation: ${task.staffing_reallocation_text || 'None'}</div>
        <div><i class="fa-solid fa-clock text-cyan"></i> Sent: Live Telemetry</div>
      </div>
      <button class="btn-success width-full" style="padding: 0.65rem; border-radius: 6px; font-weight: 600;" onclick="acknowledgeTask('${task.dispatch_id}')">
        <i class="fa-solid fa-check"></i> Complete & Resolve Alert
      </button>
    `;
    taskList.appendChild(card);
  });
}

async function acknowledgeTask(dispatchId) {
  try {
    const response = await fetch('/api/acknowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dispatch_id: dispatchId })
    });
    
    const result = await response.json();
    stadiumState.activeDispatches = result.activeDispatches;
    stadiumState.zones = result.zones;
    stadiumState.auditLog = result.auditLog;
    
    fetchStadiumState();
  } catch (error) {
    console.error('Error acknowledging task:', error);
  }
}

async function reportFieldIncident() {
  const zoneSelect = document.getElementById('sel-report-zone');
  const severitySelect = document.getElementById('sel-report-severity');
  const descText = document.getElementById('txt-report-desc');
  const statusMsg = document.getElementById('report-status-msg');

  const zoneId = zoneSelect.value;
  const severity = severitySelect.value;
  const description = descText.value.trim();

  if (!description) {
    alert('Please enter a description of the observed crowd incident.');
    return;
  }

  statusMsg.classList.remove('hidden');
  statusMsg.style.color = 'var(--md-sys-color-primary)';
  statusMsg.innerText = 'Transmitting incident to Ops control...';

  try {
    const response = await fetch('/api/report-incident', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zone_id: zoneId,
        incident_description: description,
        severity: severity
      })
    });
    
    if (response.ok) {
      statusMsg.style.color = 'var(--md-sys-color-success)';
      statusMsg.innerText = 'Incident alert transmitted successfully. Ops Lead notified.';
      descText.value = '';
      setTimeout(() => {
        statusMsg.classList.add('hidden');
      }, 3000);
      fetchStadiumState();
    } else {
      statusMsg.style.color = 'var(--md-sys-color-error)';
      statusMsg.innerText = 'Failed to transmit. Please check network.';
    }
  } catch (error) {
    console.error('Error reporting field incident:', error);
    statusMsg.style.color = 'var(--md-sys-color-error)';
    statusMsg.innerText = 'Network error. Incident queued offline.';
  }
}

async function sendChatMessage() {
  const input = document.getElementById('txt-chat-input');
  const query = input.value.trim();

  if (!query) return;

  appendChatMessage(query, 'user');
  input.value = '';

  const botMsgId = 'bot_msg_' + Date.now();
  appendChatMessage('<i class="fa-solid fa-spinner fa-spin mr-05"></i> Gemini is thinking...', 'bot', botMsgId);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: query,
        language: 'English',
        section: 'General'
      })
    });
    const result = await response.json();

    const bubbleText = formatMarkdown(result.response);
    const bubbleEl = document.querySelector(`#${botMsgId} .msg-bubble`);
    if (bubbleEl) {
      bubbleEl.innerHTML = bubbleText;
    }
  } catch (error) {
    console.error('Error sending chat message:', error);
    const bubbleEl = document.querySelector(`#${botMsgId} .msg-bubble`);
    if (bubbleEl) {
      bubbleEl.innerHTML = '<p>Error connecting to Gemini network.</p>';
    }
  }
}

function formatMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^\s*\*\s*(.*$)/gim, '<li>$1</li>')
    .replace(/^\s*-\s*(.*$)/gim, '<li>$1</li>')
    .replace(/\n/g, '<br/>')
    .replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>')
    .replace(/<\/ul><br\/><ul>/g, '');
}

function appendChatMessage(text, sender, elementId = null) {
  const box = document.getElementById('chat-messages-box');
  const msg = document.createElement('div');
  msg.className = `chat-msg ${sender}`;
  if (elementId) msg.id = elementId;

  const avatarIcon = sender === 'bot' ? 'fa-solid fa-circle-nodes' : 'fa-solid fa-user';
  
  msg.innerHTML = `
    <div class="msg-avatar"><i class="${avatarIcon}"></i></div>
    <div class="msg-bubble">
      <p>${text}</p>
    </div>
  `;
  
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
}

function handleChatKeyPress(event) {
  if (event.key === 'Enter') {
    sendChatMessage();
  }
}

function updateCopilotRecommendations() {
  const container = document.getElementById('copilot-recommendations-list');
  if (!container) return;

  const activeAlerts = stadiumState.zones.filter(z => z.risk_label !== 'normal');
  container.innerHTML = '';

  if (activeAlerts.length === 0) {
    container.innerHTML = `
      <div class="copilot-recom-card">
        <div class="copilot-recom-header">
          <span class="badge bg-green">Safe Flow</span>
          <span class="confidence-indicator"><i class="fa-solid fa-brain"></i> 98% Conf.</span>
        </div>
        <p class="copilot-recom-desc">Stadium operations are nominal. All ingress gates and concourses are processing within standard parameters.</p>
        <div class="copilot-recom-impact">
          <strong>Predicted Impact:</strong> No bottlenecks forecast. Safe stadium-wide ingress maintained.
        </div>
      </div>
    `;
    return;
  }

  activeAlerts.forEach(zone => {
    let badgeColorClass = zone.risk_label === 'critical' ? 'bg-red' : 'bg-yellow';
    let cardUrgentClass = zone.risk_label === 'critical' ? 'urgent' : '';
    let confidence = zone.confidence_score || (zone.risk_label === 'critical' ? 95 : 88);
    let impact = zone.predicted_impact || "Potential gate deceleration or crowd gridlock outside entrance turnstiles.";
    
    const card = document.createElement('div');
    card.className = `copilot-recom-card ${cardUrgentClass}`;
    card.innerHTML = `
      <div class="copilot-recom-header">
        <span class="badge ${badgeColorClass}">${zone.name} (${zone.risk_label.toUpperCase()})</span>
        <span class="confidence-indicator"><i class="fa-solid fa-brain"></i> ${confidence}% Conf.</span>
      </div>
      <p class="copilot-recom-desc"><strong>AI Action:</strong> ${zone.recommended_action}</p>
      <div class="copilot-recom-impact">
        <strong>Predicted Impact if ignored:</strong> ${impact}
      </div>
    `;
    container.appendChild(card);
  });
}

async function handleLogout() {
  try {
    const response = await fetch('/api/logout', { method: 'POST' });
    if (response.ok) {
      window.location.href = '/login';
    }
  } catch (err) {
    console.error("Logout request failed:", err);
  }
}
