// StadiumPulse AI — Fan Concierge Controller
let currentRole = 'fan';
let stadiumState = {
  zones: [],
  activeDispatches: [],
  auditLog: [],
  simulationPreset: 'normal'
};

// Coordinates mapping for path lines (if visual overlays are added)
const routeCoordinates = {
  'gate_1': { x: 400, y: 55 },
  'gate_2': { x: 710, y: 255 },
  'gate_3': { x: 400, y: 450 },
  'gate_4': { x: 90, y: 255 },
  'concourse_a': { x: 400, y: 152 },
  'concourse_b': { x: 560, y: 255 },
  'concourse_c': { x: 400, y: 360 },
  'concourse_d': { x: 240, y: 255 },
  '105': { x: 400, y: 220 }, 
  '115': { x: 460, y: 250 }, 
  '210': { x: 400, y: 280 }, 
  '225': { x: 340, y: 250 }  
};

const seatingSectionsMapping = {
  '105': { gate: 'gate_1', concourse: 'concourse_a', label: 'Sections 100-110 (North Stand)' },
  '115': { gate: 'gate_2', concourse: 'concourse_b', label: 'Sections 111-125 (East Stand)' },
  '210': { gate: 'gate_3', concourse: 'concourse_c', label: 'Sections 200-215 (South Stand)' },
  '225': { gate: 'gate_4', concourse: 'concourse_d', label: 'Sections 216-230 (West Stand)' }
};

document.addEventListener('DOMContentLoaded', () => {
  fetchStadiumState().then(() => {
    calculateFanRoute();
  });
  setInterval(fetchStadiumState, 5000);
  
  // Set default Fan Welcome Greeting
  const chatMessages = document.getElementById('chat-messages-box');
  if (chatMessages) {
    chatMessages.innerHTML = `
      <div class="chat-msg bot">
        <div class="msg-avatar"><i class="fa-solid fa-sparkles"></i></div>
        <div class="msg-bubble">
          <p>Welcome to the <strong>FIFA World Cup 2026 Fan Concierge</strong>! ⚽️</p>
          <p>I can help you navigate the stadium, guide you around crowd congestion, look up your seating gate, or answer questions about bag policies and local transit. How can I assist you today?</p>
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

    updateFanAlerts();
    updateCopilotRecommendations();
  } catch (error) {
    console.error('Error fetching stadium state:', error);
  }
}

function calculateFanRoute() {
  const gateId = document.getElementById('sel-fan-gate').value;
  const sectionId = document.getElementById('sel-fan-section').value;
  const pathContainer = document.getElementById('fan-route-path');
  const alertContainer = document.getElementById('fan-route-safety-status');

  if (!pathContainer || !alertContainer) return;

  const mapping = seatingSectionsMapping[sectionId];
  if (!mapping) return;

  const gateName = gateId === 'gate_1' ? 'Gate 1 (North)' : (gateId === 'gate_2' ? 'Gate 2 (East)' : (gateId === 'gate_3' ? 'Gate 3 (South)' : 'Gate 4 (West)'));
  const concourseName = mapping.concourse === 'concourse_a' ? 'Concourse A (North)' : (mapping.concourse === 'concourse_b' ? 'Concourse B (East)' : (mapping.concourse === 'concourse_c' ? 'Concourse C (South)' : 'Concourse D (West)'));

  // Route Analysis
  const pathZones = [gateId, mapping.concourse];
  const congestedPathZones = stadiumState.zones.filter(z => pathZones.includes(z.zone_id) && z.risk_label !== 'normal');

  // Render path flow line
  pathContainer.innerHTML = `
    <span>${gateName}</span>
    <i class="fa-solid fa-arrow-right text-muted"></i>
    <span>${concourseName}</span>
    <i class="fa-solid fa-arrow-right text-muted"></i>
    <span class="text-cyan">${mapping.label.split(' (')[0]}</span>
  `;

  if (congestedPathZones.length > 0) {
    const listNames = congestedPathZones.map(z => z.name.split(' (')[0]).join(' & ');
    const alternativeGateId = mapping.gate;
    const alternativeGateName = alternativeGateId === 'gate_1' ? 'Gate 1 (North)' : (alternativeGateId === 'gate_2' ? 'Gate 2 (East)' : (alternativeGateId === 'gate_3' ? 'Gate 3 (South)' : 'Gate 4 (West)'));
    
    alertContainer.innerHTML = `
      <i class="fa-solid fa-triangle-exclamation text-danger"></i> 
      <strong>Congestion Alert:</strong> ${listNames} has heavy congestion right now. 
      We recommend redirecting to enter via <strong class="text-purple">${alternativeGateName}</strong> for a faster route.
    `;
    alertContainer.className = 'status-warning border-red-accent';
  } else {
    alertContainer.innerHTML = `
      <i class="fa-solid fa-circle-check text-green"></i> 
      <strong>Clear Route:</strong> No crowd bottlenecks detected along this entry route. Enjoy the match!
    `;
    alertContainer.className = 'status-warning';
  }
}

function updateFanAlerts() {
  const alertBanner = document.getElementById('fan-broadcast-alert');
  const alertText = document.getElementById('fan-broadcast-alert-text');

  if (!alertBanner || !alertText) return;

  const criticalDispatches = stadiumState.activeDispatches.filter(d => d.risk_label === 'critical');
  
  if (criticalDispatches.length > 0) {
    alertBanner.classList.remove('hidden');
    alertText.innerText = `World Cup Alert: ${criticalDispatches[0].zone_name} is congested. Fans advised: "${criticalDispatches[0].action_text}"`;
  } else {
    alertBanner.classList.add('hidden');
  }
}

async function sendChatMessage() {
  const input = document.getElementById('txt-chat-input');
  const query = input.value.trim();
  const section = document.getElementById('sel-fan-section') ? document.getElementById('sel-fan-section').value : '210';

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
        section: section
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
      bubbleEl.innerHTML = '<p>Error connecting to Fan Concierge network.</p>';
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

  const avatarIcon = sender === 'bot' ? 'fa-solid fa-sparkles' : 'fa-solid fa-user';
  
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
        </div>
        <p class="copilot-recom-desc">Stadium entrances are operating normally. All security gates report standard transit flow.</p>
      </div>
    `;
    return;
  }

  activeAlerts.forEach(zone => {
    let badgeColorClass = zone.risk_label === 'critical' ? 'bg-red' : 'bg-yellow';
    const card = document.createElement('div');
    card.className = 'copilot-recom-card';
    card.innerHTML = `
      <div class="copilot-recom-header">
        <span class="badge ${badgeColorClass}">${zone.name} (${zone.risk_label.toUpperCase()})</span>
      </div>
      <p class="copilot-recom-desc"><strong>Crowd Advisory:</strong> ${zone.fan_facing_message || zone.explanation}</p>
    `;
    container.appendChild(card);
  });
}
