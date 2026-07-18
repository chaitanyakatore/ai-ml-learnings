// StadiumPulse AI — Operations Controller
let currentRole = 'ops';
let selectedZoneId = null;
let activeBriefTab = 'summary'; // 'summary' or 'playbook'
let stadiumState = {
  zones: [],
  activeDispatches: [],
  auditLog: [],
  simulationPreset: 'normal'
};
let occupancyHistory = [20, 22, 25, 24, 21, 23, 20, 22, 25, 21];

document.addEventListener('DOMContentLoaded', () => {
  fetchStadiumState().then(() => {
    refreshBriefingData();
  });
  setInterval(fetchStadiumState, 5000);
  setupSvgListeners();
  
  // Set default Operations Welcome Greeting
  const chatMessages = document.getElementById('chat-messages-box');
  if (chatMessages) {
    chatMessages.innerHTML = `
      <div class="chat-msg bot">
        <div class="msg-avatar"><i class="fa-solid fa-circle-nodes"></i></div>
        <div class="msg-bubble">
          <p>Welcome to the <strong>Gemini AI Operations Copilot</strong>! ⚽️</p>
          <p>I can help you monitor crowd flows, suggest volunteer reallocations, draft announcements, or answer operations and rules questions. How can I assist you today?</p>
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

    updateHeatmapColors();
    updateKPIs();
    updateIncidentDropdown();
    renderAuditTimeline();
    updateCopilotRecommendations();
    
    if (selectedZoneId) {
      updateInspectorView();
    }
  } catch (error) {
    console.error('Error fetching stadium state:', error);
  }
}

function updateHeatmapColors() {
  stadiumState.zones.forEach(zone => {
    const el = document.getElementById(zone.zone_id);
    if (el) {
      el.classList.remove('normal', 'elevated', 'critical');
      el.classList.add(zone.risk_label || 'normal');
    }
  });
}

function updateKPIs() {
  const activeAlertsCount = stadiumState.zones.filter(z => z.risk_label !== 'normal').length;
  const avgOccupancy = Math.round(stadiumState.zones.reduce((sum, z) => sum + z.occupancy_pct, 0) / stadiumState.zones.length);

  const alertsBadge = document.getElementById('lbl-kpi-alerts');
  if (alertsBadge) {
    alertsBadge.innerText = `${activeAlertsCount} Active Alert${activeAlertsCount !== 1 ? 's' : ''}`;
    if (activeAlertsCount > 0) {
      alertsBadge.className = 'badge bg-red';
    } else {
      alertsBadge.className = 'badge bg-purple';
    }
  }

  if (stadiumState.zones.length > 0) {
    occupancyHistory.push(avgOccupancy);
    if (occupancyHistory.length > 10) {
      occupancyHistory.shift();
    }
    drawSparkline(occupancyHistory);
  }

  const avgOccGauge = document.getElementById('gauge-avg-occ');
  const avgOccLabel = document.getElementById('lbl-kpi-avg-occ');
  if (avgOccGauge) {
    avgOccGauge.innerText = `${avgOccupancy}%`;
    if (avgOccupancy > 65) {
      avgOccGauge.style.color = 'var(--md-sys-color-error)';
      if (avgOccLabel) avgOccLabel.innerText = 'Critical Density';
    } else if (avgOccupancy > 40) {
      avgOccGauge.style.color = 'var(--md-sys-color-warning)';
      if (avgOccLabel) avgOccLabel.innerText = 'Moderate Inflow';
    } else {
      avgOccGauge.style.color = 'var(--md-sys-color-primary)';
      if (avgOccLabel) avgOccLabel.innerText = 'Nominal Capacity';
    }
  }

  const riskIndexGauge = document.getElementById('gauge-risk-index');
  const riskIndexLabel = document.getElementById('lbl-kpi-risk-index');
  if (riskIndexGauge && riskIndexLabel) {
    let riskText = 'LOW';
    let riskColor = 'var(--md-sys-color-success)';
    let riskDesc = 'Stable Operations';

    const hasCritical = stadiumState.zones.some(z => z.risk_label === 'critical');
    const hasElevated = stadiumState.zones.some(z => z.risk_label === 'elevated');

    if (hasCritical) {
      riskText = 'HIGH';
      riskColor = 'var(--md-sys-color-error)';
      riskDesc = 'Action Required';
    } else if (hasElevated) {
      riskText = 'MOD';
      riskColor = 'var(--md-sys-color-warning)';
      riskDesc = 'Monitoring Active';
    }

    riskIndexGauge.innerText = riskText;
    riskIndexGauge.style.color = riskColor;
    riskIndexLabel.innerText = riskDesc;
  }
}

function drawSparkline(history) {
  const path = document.getElementById('sparkline-path');
  const area = document.getElementById('sparkline-area');
  if (!path || !area) return;

  const width = 200;
  const height = 45;
  const maxVal = 100;

  let points = [];
  history.forEach((val, index) => {
    const x = (index / (history.length - 1)) * width;
    const y = height - (val / maxVal) * (height - 10) - 5;
    points.push({ x, y });
  });

  const dPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  path.setAttribute('d', dPath);

  const dArea = `${dPath} L ${width} ${height} L 0 ${height} Z`;
  area.setAttribute('d', dArea);
}

function updateIncidentDropdown() {
  const select = document.getElementById('sel-dispatch-zone');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="">Select a zone...</option>';

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

  select.onchange = (e) => {
    const zoneId = e.target.value;
    loadAiRecommendationsIntoForm(zoneId);
  };
}

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

function setupSvgListeners() {
  const zonesList = ['gate_1', 'gate_2', 'gate_3', 'gate_4', 'concourse_a', 'concourse_b', 'concourse_c', 'concourse_d', 'transit_hub_x', 'transit_hub_y'];
  
  zonesList.forEach(zoneId => {
    const el = document.getElementById(zoneId);
    if (el) {
      el.addEventListener('click', () => {
        zonesList.forEach(id => {
          const zEl = document.getElementById(id);
          if (zEl) zEl.style.strokeWidth = '';
        });
        el.style.strokeWidth = '4.5';

        selectedZoneId = zoneId;
        updateInspectorView();
        
        const select = document.getElementById('sel-dispatch-zone');
        if (select) {
          const matchingOpt = Array.from(select.options).some(opt => opt.value === zoneId);
          if (matchingOpt) {
            select.value = zoneId;
            loadAiRecommendationsIntoForm(zoneId);
          }
        }
        
        // Auto-switch to Playbook tab and compile directives
        switchBriefTab('playbook');
        loadCoordinatedPlaybook();
      });
    }
  });
}

function inspectZone(zoneId) {
  selectedZoneId = zoneId;
  updateInspectorView();
  switchBriefTab('playbook');
  loadCoordinatedPlaybook();
}

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
  
  let occ = zone.occupancy_pct;
  let flow = zone.flow_rate;
  let label = zone.risk_label;

  const badge = document.getElementById('inspect-zone-badge');
  badge.innerText = label.toUpperCase();
  badge.className = 'badge';
  if (label === 'critical') badge.classList.add('bg-red');
  else if (label === 'elevated') badge.classList.add('bg-yellow');
  else badge.classList.add('bg-green');

  document.getElementById('inspect-occupancy').innerText = `${occ}%`;
  document.getElementById('inspect-flow').innerText = `${flow} p/min`;
  
  document.getElementById('cctv-queue-len').innerText = `${Math.round(occ * 0.45)} meters`;
  document.getElementById('cctv-object-count').innerText = `${Math.round(flow * 3.8)} active`;
  document.getElementById('cctv-density').innerText = `${(occ / 22).toFixed(1)} / sqm`;

  const broadcastBtn = document.getElementById('btn-generate-broadcast');
  if (broadcastBtn) {
    if (label !== 'normal') {
      broadcastBtn.removeAttribute('disabled');
    } else {
      broadcastBtn.setAttribute('disabled', 'true');
    }
  }

  document.getElementById('inspect-ai-explanation').innerText = zone.explanation || 'Flow is normal.';
  document.getElementById('inspect-ai-action').innerText = zone.recommended_action || 'No intervention required.';
  document.getElementById('inspect-ai-reallocation').innerText = zone.staffing_reallocation || 'None needed.';
  
  const etaEl = document.getElementById('inspect-ai-eta');
  if (etaEl) {
    if (zone.eta_to_critical_minutes > 0) {
      etaEl.innerHTML = `<span class="text-danger font-medium"><i class="fa-solid fa-triangle-exclamation"></i> ${zone.eta_to_critical_minutes} minutes</span> to gridlock`;
    } else if (label === 'critical') {
      etaEl.innerHTML = `<span class="text-danger font-medium"><i class="fa-solid fa-skull-crossbones"></i> Critical Block</span> active`;
    } else {
      etaEl.innerText = 'Stable flow / Low density';
    }
  }
}

async function dispatchAction() {
  const zoneSelect = document.getElementById('sel-dispatch-zone');
  const actionText = document.getElementById('txt-dispatch-action');
  const reallocationText = document.getElementById('txt-dispatch-reallocation');

  const zoneId = zoneSelect.value;
  const actionStr = actionText.value.trim();
  const staffStr = reallocationText.value.trim();

  if (!zoneId || !actionStr) {
    alert('Please select a target zone and enter a mitigation command.');
    return;
  }

  try {
    const response = await fetch('/api/dispatch-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zone_id: zoneId,
        action_text: actionStr,
        staffing_reallocation_text: staffStr
      })
    });
    
    const result = await response.json();
    stadiumState.activeDispatches = result.activeDispatches;
    stadiumState.zones = result.zones;
    stadiumState.auditLog = result.auditLog;

    // Reset inputs
    zoneSelect.value = '';
    actionText.value = '';
    reallocationText.value = '';

    fetchStadiumState();
  } catch (error) {
    console.error('Error dispatching action:', error);
  }
}

// Tabbed Briefing switcher
function switchBriefTab(tabId) {
  activeBriefTab = tabId;
  document.querySelectorAll('.briefing-tabs button').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.brief-tab-content').forEach(view => view.classList.add('hidden'));

  const activeBtn = document.getElementById(`btn-brief-${tabId}`);
  if (activeBtn) activeBtn.classList.add('active');

  const activeView = document.getElementById(`brief-tab-${tabId}-view`);
  if (activeView) activeView.classList.remove('hidden');
}

function refreshBriefingData() {
  loadIncidentSummary();
  if (selectedZoneId) {
    loadCoordinatedPlaybook();
  }
}

async function loadIncidentSummary() {
  const loader = document.getElementById('ops-summary-loading');
  const content = document.getElementById('ops-summary-content');

  loader.classList.remove('hidden');
  content.classList.add('hidden');

  try {
    const response = await fetch('/api/incident-summary');
    const data = await response.json();
    content.innerHTML = formatMarkdown(data.summary);
  } catch (error) {
    console.error('Error loading incident summary:', error);
    content.innerText = 'Unable to fetch real-time tournament briefing.';
  } finally {
    loader.classList.add('hidden');
    content.classList.remove('hidden');
  }
}

async function loadCoordinatedPlaybook() {
  const loader = document.getElementById('playbook-loading');
  const placeholder = document.getElementById('playbook-placeholder');
  const content = document.getElementById('playbook-content');

  if (!selectedZoneId) return;

  loader.classList.remove('hidden');
  placeholder.classList.add('hidden');
  content.classList.add('hidden');

  const zone = stadiumState.zones.find(z => z.zone_id === selectedZoneId);
  const incidentName = stadiumState.simulationPreset === 'normal' ? 'Standard Queue Surge' : (stadiumState.simulationPreset === 'gate_closure' ? 'Ticketing Outage & Surge' : 'Transit Shuttle Delay');

  try {
    const response = await fetch('/api/generate-playbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incident_type: incidentName,
        zone_id: selectedZoneId
      })
    });
    const data = await response.json();

    document.getElementById('lbl-playbook-title').innerText = data.playbook_title;
    
    const severityBadge = document.getElementById('lbl-playbook-severity');
    severityBadge.innerText = data.severity;
    if (data.severity === 'CRITICAL') {
      severityBadge.className = 'badge bg-red';
    } else {
      severityBadge.className = 'badge bg-yellow';
    }

    // Populate lists
    fillPlaybookList('playbook-stewards-list', data.fifa_stewards_directives);
    fillPlaybookList('playbook-security-list', data.security_command_directives);
    fillPlaybookList('playbook-medical-list', data.medical_dispatch_directives);
    fillPlaybookList('playbook-transit-list', data.transit_authority_directives);

    content.classList.remove('hidden');
  } catch (error) {
    console.error('Error compiling coordinated playbook:', error);
    placeholder.classList.remove('hidden');
  } finally {
    loader.classList.add('hidden');
  }
}

function fillPlaybookList(elementId, directives) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerHTML = '';
  if (Array.isArray(directives)) {
    directives.forEach(task => {
      const li = document.createElement('li');
      li.innerText = task;
      el.appendChild(li);
    });
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
    row.style.background = 'rgba(0,0,0,0.02)';
    row.style.padding = '0.35rem 0.65rem';
    row.style.borderRadius = '4px';
    row.style.borderLeft = '2.5px solid var(--md-sys-color-border)';
    row.style.fontSize = '0.8rem';
    row.style.fontWeight = '500';
    row.style.marginBottom = '0.25rem';

    if (log.type === 'preset') row.style.borderLeftColor = 'var(--md-sys-color-warning)';
    else if (log.type === 'dispatch') row.style.borderLeftColor = 'var(--md-sys-color-primary)';
    else if (log.type === 'resolution') row.style.borderLeftColor = 'var(--md-sys-color-success)';

    row.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <i class="${iconClass}"></i>
        <span>${log.message}</span>
      </div>
      <span class="text-muted" style="font-size: 0.75rem;">${log.timestamp}</span>
    `;
    container.appendChild(row);
  });
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
      <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
        <button class="btn-success" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 100px; font-weight: 500;" onclick="quickDispatch('${zone.zone_id}')">
          <i class="fa-solid fa-check"></i> Execute Command
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function quickDispatch(zoneId) {
  const zone = stadiumState.zones.find(z => z.zone_id === zoneId);
  if (!zone) return;

  const select = document.getElementById('sel-dispatch-zone');
  const actionText = document.getElementById('txt-dispatch-action');
  const staffText = document.getElementById('txt-dispatch-reallocation');

  if (select) select.value = zoneId;
  if (actionText) actionText.value = zone.recommended_action || '';
  if (staffText) staffText.value = zone.staffing_reallocation || 'None needed.';

  dispatchAction();
}

let latestBroadcastPackage = null;
let currentPushTab = 'en';

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
    
    setPushTab('en');
  } catch (error) {
    console.error('Error generating broadcasts:', error);
  } finally {
    btn.removeAttribute('disabled');
    btn.innerHTML = '<i class="fa-solid fa-tower-broadcast"></i> Compile AI Broadcast Script';
  }
}

function setPushTab(lang) {
  currentPushTab = lang;
  document.querySelectorAll('.translation-tabs button').forEach(b => b.classList.remove('active'));
  const activeTabBtn = document.getElementById(`tab-push-${lang}`);
  if (activeTabBtn) activeTabBtn.classList.add('active');

  const pushText = document.getElementById('broadcast-push-text');
  if (pushText && latestBroadcastPackage && latestBroadcastPackage.push_notifications) {
    pushText.innerText = latestBroadcastPackage.push_notifications[lang] || '';
  }
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
