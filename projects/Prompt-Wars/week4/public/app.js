// StadiumPulse AI — Frontend Controller

let currentRole = 'ops';
let selectedZoneId = null;
let stadiumState = {
  zones: [],
  activeDispatches: [],
  auditLog: [],
  simulationPreset: 'normal'
};
let currentTimeTravelMode = 'now'; // 'now' or 'projected'
let latestBroadcastPackage = null;
let currentPushTab = 'en';

// Map of optimal routing
const seatingSectionsMapping = {
  '105': { gate: 'gate_1', concourse: 'concourse_a', label: 'Sections 100-110 (North Stand)' },
  '115': { gate: 'gate_2', concourse: 'concourse_b', label: 'Sections 111-125 (East Stand)' },
  '210': { gate: 'gate_3', concourse: 'concourse_c', label: 'Sections 200-215 (South Stand)' },
  '225': { gate: 'gate_4', concourse: 'concourse_d', label: 'Sections 216-230 (West Stand)' }
};

// Initial Setup
document.addEventListener('DOMContentLoaded', () => {
  // Initial data pull
  fetchStadiumState().then(() => {
    // Set default route calculation
    calculateFanRoute();
    // Load executive operations summary
    loadIncidentSummary();
  });

  // Start polling stadium state every 5 seconds to keep dashboard live
  setInterval(fetchStadiumState, 5000);

  // Setup SVG Click Listeners for Heatmap
  setupSvgListeners();
});

// Fetch stadium state from the Express API
async function fetchStadiumState() {
  try {
    const response = await fetch('/api/stadium-state');
    const data = await response.json();
    stadiumState = data;

    updateHeatmapColors();
    updateKPIs();
    updateIncidentDropdown();
    renderAuditTimeline();
    
    if (currentRole === 'ops') {
      updateInspectorView();
    } else if (currentRole === 'volunteer') {
      renderVolunteerTasks();
    } else if (currentRole === 'fan') {
      updateFanAlerts();
    }
  } catch (error) {
    console.error('Error fetching stadium state:', error);
  }
}

// Update SVG fill colors based on live risk levels
function updateHeatmapColors() {
  stadiumState.zones.forEach(zone => {
    const el = document.getElementById(zone.zone_id);
    if (el) {
      // Remove previous risk classes
      el.classList.remove('normal', 'elevated', 'critical');
      
      let label = zone.risk_label;
      if (currentTimeTravelMode === 'projected') {
        let occ = zone.occupancy_pct;
        if (zone.trend === 'increasing') occ = Math.min(100, Math.round(occ * 1.15));
        else if (zone.trend === 'decreasing') occ = Math.max(10, Math.round(occ * 0.8));
        label = occ > 80 ? 'critical' : (occ > 55 ? 'elevated' : 'normal');
      }
      
      el.classList.add(label || 'normal');
    }
  });
}

// Update header KPIs and alert counts
function updateKPIs() {
  const activeAlertsCount = stadiumState.zones.filter(z => z.risk_label !== 'normal').length;
  const avgOccupancy = Math.round(stadiumState.zones.reduce((sum, z) => sum + z.occupancy_pct, 0) / stadiumState.zones.length);
  const totalStaff = stadiumState.zones.reduce((sum, z) => sum + z.current_staff, 0);

  const alertsBadge = document.getElementById('lbl-kpi-alerts');
  if (alertsBadge) {
    alertsBadge.innerText = `${activeAlertsCount} Active Incident${activeAlertsCount !== 1 ? 's' : ''}`;
    if (activeAlertsCount > 0) {
      alertsBadge.classList.remove('bg-green');
      alertsBadge.classList.add('bg-red');
    } else {
      alertsBadge.classList.remove('bg-red');
      alertsBadge.classList.add('bg-green');
    }
  }

  const avgOccEl = document.getElementById('lbl-kpi-avg-occ');
  if (avgOccEl) {
    avgOccEl.innerText = `${avgOccupancy}%`;
    if (avgOccupancy > 65) {
      avgOccEl.className = 'kpi-value text-danger';
    } else if (avgOccupancy > 40) {
      avgOccEl.className = 'kpi-value text-warning';
    } else {
      avgOccEl.className = 'kpi-value text-cyan';
    }
  }

  const staffEl = document.getElementById('lbl-kpi-total-staff');
  if (staffEl) {
    staffEl.innerText = totalStaff;
  }
}

// Populate the action dispatcher dropdown in Ops dashboard
function updateIncidentDropdown() {
  const select = document.getElementById('sel-dispatch-zone');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="">Select a zone...</option>';

  // Only list zones with elevated/critical risk for dispatch options
  const riskZones = stadiumState.zones.filter(z => z.risk_label !== 'normal');
  riskZones.forEach(zone => {
    const opt = document.createElement('option');
    opt.value = zone.zone_id;
    opt.innerText = `${zone.name} (${zone.risk_label.toUpperCase()})`;
    select.appendChild(opt);
  });

  if (currentVal && stadiumState.zones.find(z => z.zone_id === currentVal && z.risk_label !== 'normal')) {
    select.value = currentVal;
  }

  // Set listener to fill instructions when dropdown changes
  select.onchange = (e) => {
    const zoneId = e.target.value;
    loadAiRecommendationsIntoForm(zoneId);
  };
}

// Automatically load Gemini's reasoning outputs into the dispatch forms
function loadAiRecommendationsIntoForm(zoneId) {
  const zone = stadiumState.zones.find(z => z.zone_id === zoneId);
  const actionText = document.getElementById('txt-dispatch-action');
  const staffText = document.getElementById('txt-dispatch-reallocation');

  if (zone && zone.risk_label !== 'normal') {
    actionText.value = zone.recommended_action || '';
    staffText.value = zone.staffing_reallocation || 'None needed.';
  } else {
    actionText.value = '';
    staffText.value = '';
  }
}

// SVG Heatmap click behaviors
function setupSvgListeners() {
  const zonesList = ['gate_1', 'gate_2', 'gate_3', 'gate_4', 'concourse_a', 'concourse_b', 'concourse_c', 'concourse_d', 'transit_hub_x', 'transit_hub_y'];
  
  zonesList.forEach(zoneId => {
    const el = document.getElementById(zoneId);
    if (el) {
      el.addEventListener('click', () => {
        // Highlight active SVG zone border
        zonesList.forEach(id => {
          const zEl = document.getElementById(id);
          if (zEl) zEl.style.strokeWidth = '';
        });
        el.style.strokeWidth = '4.5';

        selectedZoneId = zoneId;
        updateInspectorView();
        
        // Proactively set the dispatcher select values if in Ops view
        const select = document.getElementById('sel-dispatch-zone');
        if (select) {
          const matchingOpt = Array.from(select.options).some(opt => opt.value === zoneId);
          if (matchingOpt) {
            select.value = zoneId;
            loadAiRecommendationsIntoForm(zoneId);
          }
        }
      });
    }
  });
}

// Update the Inspector panel sidebar contents
function updateInspectorView() {
  const placeholder = document.getElementById('inspector-placeholder');
  const content = document.getElementById('inspector-content');

  if (!selectedZoneId) {
    placeholder.classList.remove('hidden');
    content.classList.add('hidden');
    return;
  }

  const zone = stadiumState.zones.find(z => z.zone_id === selectedZoneId);
  if (!zone) return;

  placeholder.classList.add('hidden');
  content.classList.remove('hidden');

  document.getElementById('inspect-zone-name').innerText = zone.name;
  
  // Time travel math projections
  let occ = zone.occupancy_pct;
  let flow = zone.flow_rate;
  let label = zone.risk_label;
  if (currentTimeTravelMode === 'projected') {
    if (zone.trend === 'increasing') {
      occ = Math.min(100, Math.round(occ * 1.15));
      flow = Math.round(flow * 1.10);
    } else if (zone.trend === 'decreasing') {
      occ = Math.max(10, Math.round(occ * 0.80));
      flow = Math.round(flow * 0.85);
    }
    label = occ > 80 ? 'critical' : (occ > 55 ? 'elevated' : 'normal');
  }

  const badge = document.getElementById('inspect-zone-badge');
  badge.innerText = `${label.toUpperCase()} ${currentTimeTravelMode === 'projected' ? '(PROJ)' : ''}`;
  badge.className = 'badge';
  if (label === 'critical') badge.classList.add('bg-red');
  else if (label === 'elevated') badge.classList.add('bg-orange');
  else badge.classList.add('bg-green');

  document.getElementById('inspect-occupancy').innerText = `${occ}% ${currentTimeTravelMode === 'projected' ? '(Projected)' : ''}`;
  document.getElementById('inspect-flow').innerText = `${flow} p/min ${currentTimeTravelMode === 'projected' ? '(Projected)' : ''}`;
  
  const trendEl = document.getElementById('inspect-trend');
  trendEl.innerText = zone.trend.charAt(0).toUpperCase() + zone.trend.slice(1);
  trendEl.className = zone.trend === 'increasing' ? 'text-danger' : (zone.trend === 'decreasing' ? 'text-cyan' : 'text-warning');

  document.getElementById('inspect-staff').innerText = zone.current_staff;

  // CCTV diagnostics math
  document.getElementById('cctv-cam-id').innerText = `CAM-ID: CCTV_${zone.zone_id.toUpperCase()}`;
  document.getElementById('cctv-queue-len').innerText = `${Math.round(occ * 0.45)} meters`;
  document.getElementById('cctv-object-count').innerText = `${Math.round(flow * 3.8)} active`;
  document.getElementById('cctv-density').innerText = `${(occ / 22).toFixed(1)} / sqm`;

  // Enable/Disable AI Broadcast compile button
  const broadcastBtn = document.getElementById('btn-generate-broadcast');
  if (broadcastBtn) {
    if (label !== 'normal') {
      broadcastBtn.removeAttribute('disabled');
    } else {
      broadcastBtn.setAttribute('disabled', 'true');
    }
  }

  // AI assessment fields
  document.getElementById('inspect-ai-explanation').innerText = zone.explanation || 'Flow is normal.';
  document.getElementById('inspect-ai-action').innerText = zone.recommended_action || 'No intervention required.';
  document.getElementById('inspect-ai-reallocation').innerText = zone.staffing_reallocation || 'None needed.';
  
  const etaEl = document.getElementById('inspect-ai-eta');
  if (zone.eta_to_critical_minutes > 0) {
    etaEl.innerHTML = `<span class="text-danger font-medium"><i class="fa-solid fa-triangle-exclamation"></i> ${zone.eta_to_critical_minutes} minutes</span> to gridlock`;
  } else if (label === 'critical') {
    etaEl.innerHTML = `<span class="text-danger font-medium"><i class="fa-solid fa-skull-crossbones"></i> Critical Block</span> active`;
  } else {
    etaEl.innerText = 'Stable flow / Low density';
    etaEl.className = 'text-muted';
  }
}

// Switch dashboard role tabs
function switchRole(role) {
  currentRole = role;
  
  // Update Buttons
  document.querySelectorAll('.btn-role').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`btn-view-${role}`).classList.add('active');

  // Update Sections
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  document.getElementById(`view-section-${role}`).classList.add('active');

  // Load section-specific modules
  if (role === 'ops') {
    updateInspectorView();
  } else if (role === 'volunteer') {
    renderVolunteerTasks();
  } else if (role === 'fan') {
    updateFanAlerts();
    calculateFanRoute();
  }
}

// Set active simulation preset (Dev Control Room)
async function setPreset(preset) {
  // Update UI active buttons
  document.querySelectorAll('.btn-preset').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`btn-preset-${preset}`).classList.add('active');

  // Label text
  const labels = {
    normal: 'Normal Flow',
    halftime: 'Halftime Concourse Rush',
    gate_closure: 'Gate 3 Security Closure',
    exit_surge: 'Post-Match Exit Surge'
  };
  document.getElementById('lbl-active-preset').innerText = labels[preset];

  try {
    const response = await fetch('/api/simulate-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset })
    });
    const result = await response.json();
    stadiumState.zones = result.zones;
    stadiumState.activeDispatches = result.activeDispatches;
    
    // Clear selections and reload
    selectedZoneId = null;
    fetchStadiumState();
    loadIncidentSummary();
  } catch (error) {
    console.error('Error setting simulation preset:', error);
  }
}

// Submit a dispatched command from Operations to volunteers/fans
async function dispatchAction() {
  const zoneId = document.getElementById('sel-dispatch-zone').value;
  const actionText = document.getElementById('txt-dispatch-action').value;
  const staffText = document.getElementById('txt-dispatch-reallocation').value;

  if (!zoneId) {
    alert('Please select a target incident zone first.');
    return;
  }

  try {
    const response = await fetch('/api/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zone_id: zoneId,
        action_text: actionText,
        staffing_reallocation_text: staffText
      })
    });
    
    const result = await response.json();
    stadiumState.activeDispatches = result.activeDispatches;
    stadiumState.zones = result.zones;

    // Reset select fields
    document.getElementById('sel-dispatch-zone').value = '';
    document.getElementById('txt-dispatch-action').value = '';
    document.getElementById('txt-dispatch-reallocation').value = '';
    
    alert('Mitigation command dispatched successfully to all terminals.');
    fetchStadiumState();
  } catch (error) {
    console.error('Error dispatching action:', error);
  }
}

// Render task list cards on the Volunteer workspace
function renderVolunteerTasks() {
  const container = document.getElementById('volunteer-task-list');
  const emptyState = document.getElementById('volunteer-empty-state');
  const countBadge = document.getElementById('lbl-volunteer-task-count');
  
  container.innerHTML = '';
  
  const activeTasks = stadiumState.activeDispatches.filter(d => !d.acknowledged);
  countBadge.innerText = `${activeTasks.length} TASK${activeTasks.length !== 1 ? 'S' : ''} ACTIVE`;

  if (activeTasks.length === 0) {
    emptyState.classList.remove('hidden');
    container.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  container.classList.remove('hidden');

  activeTasks.forEach(task => {
    const card = document.createElement('div');
    card.className = `task-card glass-panel`;
    
    if (task.risk_label === 'critical') card.classList.add('bg-red-line');
    else if (task.risk_label === 'elevated') card.classList.add('bg-orange-line');

    card.innerHTML = `
      <div class="task-info">
        <div class="task-zone-header">
          <span class="badge ${task.risk_label === 'critical' ? 'bg-red' : 'bg-orange'}">${task.risk_label.toUpperCase()} Alert</span>
          <h4>${task.zone_name}</h4>
        </div>
        <p class="task-action-desc"><i class="fa-solid fa-circle-exclamation text-warning"></i> <strong>Command:</strong> ${task.action_text}</p>
        ${task.staffing_reallocation_text && task.staffing_reallocation_text !== 'None needed.' ? 
          `<p class="task-reallocation-desc"><i class="fa-solid fa-users-gear"></i> ${task.staffing_reallocation_text}</p>` : ''}
        <span class="task-time"><i class="fa-regular fa-clock"></i> Dispatched: ${task.timestamp}</span>
      </div>
      <div>
        <button class="btn-success py-05 px-1" onclick="resolveVolunteerTask('${task.dispatch_id}')">
          <i class="fa-solid fa-check"></i> Complete & Resolve
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

// Volunteer resolves a task card
async function resolveVolunteerTask(dispatchId) {
  try {
    const response = await fetch('/api/acknowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dispatch_id: dispatchId })
    });
    
    const result = await response.json();
    stadiumState.activeDispatches = result.activeDispatches;
    stadiumState.zones = result.zones;
    
    fetchStadiumState();
  } catch (error) {
    console.error('Error resolving task:', error);
  }
}

// Calculate the safest path from gate to section
function calculateFanRoute() {
  const gateId = document.getElementById('sel-fan-gate').value;
  const sectionId = document.getElementById('sel-fan-section').value;
  
  const mapping = seatingSectionsMapping[sectionId];
  if (!mapping) return;

  const pathContainer = document.getElementById('fan-route-path');
  const alertContainer = document.getElementById('fan-route-safety-status');

  const gateName = document.getElementById('sel-fan-gate').options[document.getElementById('sel-fan-gate').selectedIndex].text.split(' (')[0];
  const concourseName = mapping.concourse === 'concourse_a' ? 'Concourse A' : (mapping.concourse === 'concourse_b' ? 'Concourse B' : (mapping.concourse === 'concourse_c' ? 'Concourse C' : 'Concourse D'));

  // Calculate if the chosen path has congestion
  const pathZones = [gateId, mapping.concourse];
  const congestedPathZones = pathZones.map(id => stadiumState.zones.find(z => z.zone_id === id)).filter(z => z && z.risk_label !== 'normal');

  // Highlight route dynamically on SVG (remove previous paths, add new style)
  stadiumState.zones.forEach(z => {
    const el = document.getElementById(z.zone_id);
    if (el) el.style.stroke = ''; // Clear custom strokes
  });
  
  pathZones.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.stroke = '#8b5cf6'; // Highlight path with electric purple
      el.style.strokeWidth = '4';
    }
  });

  // Render path flow line
  pathContainer.innerHTML = `
    <span>${gateName}</span>
    <i class="fa-solid fa-arrow-right text-muted"></i>
    <span>${concourseName}</span>
    <i class="fa-solid fa-arrow-right text-muted"></i>
    <span class="text-cyan">${mapping.label.split(' (')[0]}</span>
  `;

  // Render warning message if path contains congested elements
  if (congestedPathZones.length > 0) {
    const listNames = congestedPathZones.map(z => z.name.split(' (')[0]).join(' & ');
    
    // Propose alternative gate
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

// Display warning banners in Fan view when dispatches target entry paths
function updateFanAlerts() {
  const alertBanner = document.getElementById('fan-broadcast-alert');
  const alertText = document.getElementById('fan-broadcast-alert-text');

  // Get active dispatches
  const criticalDispatches = stadiumState.activeDispatches.filter(d => d.risk_label === 'critical');
  
  if (criticalDispatches.length > 0) {
    alertBanner.classList.remove('hidden');
    alertText.innerText = `World Cup Alert: ${criticalDispatches[0].zone_name} is congested. fans advised: "${criticalDispatches[0].action_text}"`;
  } else {
    alertBanner.classList.add('hidden');
  }
}

// Load executive summary of operations via Gemini
async function loadIncidentSummary() {
  const loader = document.getElementById('ops-summary-loading');
  const content = document.getElementById('ops-summary-content');

  loader.classList.remove('hidden');
  content.classList.add('hidden');

  try {
    const response = await fetch('/api/incident-summary');
    const data = await response.json();
    
    // Convert basic Markdown headers and list items to structured HTML
    content.innerHTML = formatMarkdown(data.summary);
  } catch (error) {
    console.error('Error loading incident summary:', error);
    content.innerText = 'Unable to fetch real-time tournament incident briefing.';
  } finally {
    loader.classList.add('hidden');
    content.classList.remove('hidden');
  }
}

// Simple Markdown formatting helper for briefing/chat responses
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
    .replace(/<\/ul><br\/><ul>/g, ''); // Fix double list spacing
}

// Fan Chat logic
async function sendChatMessage() {
  const input = document.getElementById('txt-chat-input');
  const query = input.value.trim();
  const lang = document.getElementById('sel-fan-lang').value;
  const section = document.getElementById('sel-fan-section').value;

  if (!query) return;

  // Append user message
  appendChatMessage(query, 'user');
  input.value = '';

  // Append thinking bubble
  const botMsgId = 'bot_msg_' + Date.now();
  appendChatMessage('<i class="fa-solid fa-spinner fa-spin mr-05"></i> Gemini is thinking...', 'bot', botMsgId);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: query,
        language: lang,
        section: section
      })
    });
    const result = await response.json();

    // Replace thinking bubble with actual markdown response
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

function toggleDevConsole() {
  const panel = document.getElementById('sim-control-panel');
  panel.classList.toggle('collapsed');
}

// Render chronological Audit Timeline on operations screen
function renderAuditTimeline() {
  const container = document.getElementById('ops-audit-timeline');
  if (!container) return;

  const logs = stadiumState.auditLog || [];
  if (logs.length === 0) {
    container.innerHTML = `
      <div class="timeline-empty-message text-muted text-center py-2" style="font-size: 0.8rem;">
        No logs recorded. Switch simulation scenarios to populate telemetry events.
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  logs.forEach(log => {
    let iconClass = 'fa-solid fa-circle-info text-cyan';
    if (log.type === 'preset') iconClass = 'fa-solid fa-gears text-purple';
    else if (log.type === 'dispatch') iconClass = 'fa-solid fa-paper-plane text-cyan';
    else if (log.type === 'resolution') iconClass = 'fa-solid fa-circle-check text-green';
    else if (log.type === 'chat') iconClass = 'fa-solid fa-comment-dots text-warning';
    else if (log.type === 'broadcast') iconClass = 'fa-solid fa-tower-broadcast text-purple';

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.background = 'rgba(255, 255, 255, 0.01)';
    row.style.padding = '0.35rem 0.65rem';
    row.style.borderRadius = '4px';
    row.style.borderLeft = '2px solid rgba(255, 255, 255, 0.05)';
    row.style.fontSize = '0.8rem';
    row.style.fontWeight = '500';

    if (log.type === 'preset') row.style.borderLeftColor = 'var(--neon-purple)';
    else if (log.type === 'dispatch') row.style.borderLeftColor = 'var(--neon-cyan)';
    else if (log.type === 'resolution') row.style.borderLeftColor = 'var(--neon-green)';

    row.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <i class="${iconClass}"></i>
        <span style="color: #cbd5e1;">${log.message}</span>
      </div>
      <span class="text-muted" style="font-size: 0.75rem;">${log.timestamp}</span>
    `;
    container.appendChild(row);
  });
}

// Trigger AI Broadcast Announcement Package compilation
async function generateBroadcastPackage() {
  if (!selectedZoneId) return;

  const btn = document.getElementById('btn-generate-broadcast');
  const box = document.getElementById('broadcast-package-box');
  const paText = document.getElementById('broadcast-pa-text');

  btn.setAttribute('disabled', 'true');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Compiling Broadcasts...';
  
  try {
    const response = await fetch('/api/generate-broadcasts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ zone_id: selectedZoneId })
    });
    
    const data = await response.json();
    latestBroadcastPackage = data;
    
    box.classList.remove('hidden');
    paText.innerText = data.pa_audio_script;
    
    // Select default English tab
    setPushTab('en');
  } catch (error) {
    console.error('Error generating broadcasts:', error);
  } finally {
    btn.removeAttribute('disabled');
    btn.innerHTML = '<i class="fa-solid fa-tower-broadcast"></i> COMPILE AI BROADCASTS';
  }
}

// Set active push translation language tab
function setPushTab(lang) {
  currentPushTab = lang;
  
  // Set button class
  document.querySelectorAll('.translation-tabs button').forEach(b => b.classList.remove('active'));
  const activeTabBtn = document.getElementById(`tab-push-${lang}`);
  if (activeTabBtn) activeTabBtn.classList.add('active');

  const pushText = document.getElementById('broadcast-push-text');
  if (pushText && latestBroadcastPackage && latestBroadcastPackage.push_notifications) {
    pushText.innerText = latestBroadcastPackage.push_notifications[lang] || '';
  }
}

// Time Travel Slider control handler
function setTimeTravelMode(mode) {
  currentTimeTravelMode = mode;

  // Toggle active button CSS classes
  document.querySelectorAll('.time-travel-slider-box button').forEach(btn => btn.classList.remove('active'));
  if (mode === 'now') {
    document.getElementById('btn-time-now').classList.add('active');
  } else {
    document.getElementById('btn-time-projected').classList.add('active');
  }

  // Refresh colors and inspections based on mode selection
  updateHeatmapColors();
  updateKPIs();
  if (selectedZoneId) {
    updateInspectorView();
  }
}
