import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Gemini Client only if Ollama is not enabled to prevent startup errors
const ai = (process.env.USE_OLLAMA === 'true') ? null : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Unified AI model execution helper (routes to Gemini or local Ollama)
async function callAIModel(prompt, jsonMode = false, schema = null) {
  const useOllama = process.env.USE_OLLAMA === 'true';
  
  if (useOllama) {
    const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'gemma2';
    
    console.log(`Routing AI call to Ollama (model: ${model}, host: ${host})...`);
    
    let ollamaPrompt = prompt;
    if (jsonMode && schema) {
      ollamaPrompt += `\n\nYou MUST return a JSON object conforming exactly to this structure:\n${JSON.stringify(schema, null, 2)}`;
    }
    
    const response = await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: ollamaPrompt,
        stream: false,
        format: jsonMode ? 'json' : undefined,
        options: {
          temperature: 0.15
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`Ollama request failed with status: ${response.status}`);
    }
    
    const data = await response.json();
    return data.response;
  } else {
    // Standard Gemini Client call
    const config = {};
    if (jsonMode) {
      config.responseMimeType = 'application/json';
      if (schema) {
        config.responseJsonSchema = schema;
      }
    }
    
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: config
    });
    return response.text;
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Zone Data Definitions
let zones = [
  { zone_id: 'gate_1', name: 'Gate 1 (North Entrance)', type: 'gate', occupancy_pct: 20, flow_rate: 30, trend: 'stable', capacity_cap: 10000, current_staff: 12, risk_score: 0.2, risk_label: 'normal', explanation: 'Flow is stable and processing normally.', recommended_action: 'Maintain current staffing.', staffing_reallocation: 'None needed.', fan_facing_message: 'Gate 1 is clear. Enjoy the match!', history: [20, 20, 20] },
  { zone_id: 'gate_2', name: 'Gate 2 (East Entrance)', type: 'gate', occupancy_pct: 25, flow_rate: 45, trend: 'stable', capacity_cap: 8000, current_staff: 10, risk_score: 0.25, risk_label: 'normal', explanation: 'Flow is stable and processing normally.', recommended_action: 'Maintain current staffing.', staffing_reallocation: 'None needed.', fan_facing_message: 'Gate 2 is clear. Access is normal.', history: [25, 24, 25] },
  { zone_id: 'gate_3', name: 'Gate 3 (South Entrance)', type: 'gate', occupancy_pct: 30, flow_rate: 50, trend: 'increasing', capacity_cap: 12000, current_staff: 15, risk_score: 0.3, risk_label: 'normal', explanation: 'Processing entry flow normally.', recommended_action: 'Monitor flow rates.', staffing_reallocation: 'None needed.', fan_facing_message: 'Gate 3 is normal. Queue time is under 5 mins.', history: [28, 29, 30] },
  { zone_id: 'gate_4', name: 'Gate 4 (West Entrance)', type: 'gate', occupancy_pct: 18, flow_rate: 25, trend: 'stable', capacity_cap: 8000, current_staff: 8, risk_score: 0.18, risk_label: 'normal', explanation: 'Flow is stable.', recommended_action: 'Maintain current staffing.', staffing_reallocation: 'None needed.', fan_facing_message: 'Gate 4 is clear.', history: [18, 18, 18] },
  { zone_id: 'concourse_a', name: 'Concourse A (North Corridor)', type: 'concourse', occupancy_pct: 22, flow_rate: 15, trend: 'stable', capacity_cap: 6000, current_staff: 6, risk_score: 0.22, risk_label: 'normal', explanation: 'Pedestrian flow is normal.', recommended_action: 'Maintain current staffing.', staffing_reallocation: 'None needed.', fan_facing_message: 'Concourse A is clear.', history: [22, 22, 22] },
  { zone_id: 'concourse_b', name: 'Concourse B (East Corridor)', type: 'concourse', occupancy_pct: 24, flow_rate: 20, trend: 'stable', capacity_cap: 6000, current_staff: 6, risk_score: 0.24, risk_label: 'normal', explanation: 'Pedestrian flow is normal.', recommended_action: 'Maintain current staffing.', staffing_reallocation: 'None needed.', fan_facing_message: 'Concourse B is clear.', history: [24, 24, 24] },
  { zone_id: 'concourse_c', name: 'Concourse C (South Corridor)', type: 'concourse', occupancy_pct: 35, flow_rate: 35, trend: 'increasing', capacity_cap: 7000, current_staff: 8, risk_score: 0.35, risk_label: 'normal', explanation: 'Normal foot traffic.', recommended_action: 'Monitor concourse density.', staffing_reallocation: 'None needed.', fan_facing_message: 'Concourse C is normal.', history: [32, 33, 35] },
  { zone_id: 'concourse_d', name: 'Concourse D (West Corridor)', type: 'concourse', occupancy_pct: 15, flow_rate: 10, trend: 'stable', capacity_cap: 5000, current_staff: 5, risk_score: 0.15, risk_label: 'normal', explanation: 'Pedestrian flow is normal.', recommended_action: 'Maintain current staffing.', staffing_reallocation: 'None needed.', fan_facing_message: 'Concourse D is clear.', history: [15, 15, 15] },
  { zone_id: 'transit_hub_x', name: 'Transit Hub X (Light Rail Station)', type: 'transit', occupancy_pct: 12, flow_rate: 5, trend: 'stable', capacity_cap: 15000, current_staff: 8, risk_score: 0.12, risk_label: 'normal', explanation: 'Transit boarding is running on schedule.', recommended_action: 'Maintain standard schedule.', staffing_reallocation: 'None needed.', fan_facing_message: 'Transit Hub X is normal.', history: [12, 12, 12] },
  { zone_id: 'transit_hub_y', name: 'Transit Hub Y (Shuttle Bus Terminal)', type: 'transit', occupancy_pct: 15, flow_rate: 10, trend: 'stable', capacity_cap: 10000, current_staff: 6, risk_score: 0.15, risk_label: 'normal', explanation: 'Shuttle buses are boarding normally.', recommended_action: 'Maintain standard schedule.', staffing_reallocation: 'None needed.', fan_facing_message: 'Transit Hub Y is normal.', history: [15, 15, 15] }
];

let activeDispatches = [];
let auditLog = [];
let simulationPreset = 'normal';
let latestIncidentSummary = 'Stadium status is nominal. No alerts are currently triggered.';

// JSON Schema for Gemini Crowd Reasoning
const riskSchema = {
  type: "object",
  properties: {
    risk_score: { type: "number", description: "Congestion risk score from 0.0 (empty/normal) to 1.0 (extremely critical/jammed)" },
    risk_label: { type: "string", description: "Risk level categorisation. Must be 'normal', 'elevated', or 'critical'" },
    eta_to_critical_minutes: { type: "integer", description: "Estimated time in minutes before zone hits 100% capacity if current flow continues. Returns -1 if stable, decreasing or already critical" },
    explanation: { type: "string", description: "Brief (1 sentence) technical analysis of the crowd movement/congestion cause" },
    recommended_action: { type: "string", description: "Specific, direct action command for the operations staff/volunteers to resolve the congestion" },
    staffing_reallocation: { type: "string", description: "Recommendation to move staff from low occupancy zones to this zone, specifying zone IDs and numbers" },
    fan_facing_message: { type: "string", description: "A helpful, warning message for the fan dashboard guiding them to alternatives" }
  },
  required: [
    "risk_score",
    "risk_label",
    "eta_to_critical_minutes",
    "explanation",
    "recommended_action",
    "staffing_reallocation",
    "fan_facing_message"
  ]
};

// Evaluate multiple surging zones in a single batched Gemini call
async function evaluateSurgingZonesWithAI(surgingZones) {
  if (surgingZones.length === 0) return;

  try {
    const zonesDataString = surgingZones.map(z => `
- Zone ID: ${z.zone_id}
  Name: ${z.name}
  Occupancy: ${z.occupancy_pct}% (Capacity: ${z.capacity_cap})
  Flow rate: ${z.flow_rate} people/minute
  Current Staff: ${z.current_staff} volunteers
  Trend: ${z.trend}
  Recent History: ${z.history.join(', ')}
    `).join('\n');

    const prompt = `
You are the StadiumPulse AI crowd reasoning agent for the FIFA World Cup 2026.
You are evaluating the following surging/high-risk zones in the stadium:

${zonesDataString}

Active Preset Scenario: ${simulationPreset}

For each zone listed, evaluate the crowd density and flow risk.
You must output a JSON response containing an 'assessments' array of objects conforming to the schema.
Look at the other zones for staffing donors (e.g. Gate 1, 2, 4 if their occupancy is under 30%).
    `;

    const responseText = await callAIModel(prompt, true, {
      type: "object",
      properties: {
        assessments: {
          type: "array",
          items: riskSchema
        }
      },
      required: ["assessments"]
    });

    const parsedResult = JSON.parse(responseText);
    if (parsedResult.assessments && Array.isArray(parsedResult.assessments)) {
      parsedResult.assessments.forEach(assessment => {
        const zone = zones.find(z => z.zone_id === assessment.zone_id);
        if (zone) {
          zone.risk_score = assessment.risk_score;
          zone.risk_label = assessment.risk_label;
          zone.explanation = assessment.explanation;
          zone.recommended_action = assessment.recommended_action;
          zone.staffing_reallocation = assessment.staffing_reallocation;
          zone.fan_facing_message = assessment.fan_facing_message;
          zone.eta_to_critical_minutes = assessment.eta_to_critical_minutes;
        }
      });
    }
  } catch (error) {
    console.error(`Error in batched Gemini evaluation:`, error);
    // Fallback logic
    surgingZones.forEach(zone => {
      zone.risk_score = +(zone.occupancy_pct / 100).toFixed(2);
      zone.risk_label = zone.occupancy_pct > 80 ? 'critical' : 'elevated';
    });
  }
}

// Function to generate simulated sensor values based on active preset
function runSensorSimulationStep() {
  zones.forEach(zone => {
    let baseOcc = zone.occupancy_pct;
    let deltaOcc = 0;
    let baseFlow = zone.flow_rate;

    if (simulationPreset === 'normal') {
      // Normal baseline
      if (zone.zone_id.startsWith('gate')) {
        baseOcc = Math.max(15, Math.min(30, baseOcc + (Math.random() * 6 - 3)));
        baseFlow = Math.round(20 + Math.random() * 20);
      } else if (zone.zone_id.startsWith('concourse')) {
        baseOcc = Math.max(10, Math.min(25, baseOcc + (Math.random() * 4 - 2)));
        baseFlow = Math.round(10 + Math.random() * 15);
      } else {
        baseOcc = Math.max(5, Math.min(20, baseOcc + (Math.random() * 4 - 2)));
        baseFlow = Math.round(5 + Math.random() * 10);
      }
    } else if (simulationPreset === 'halftime') {
      // Halftime Concourse Surge
      if (zone.zone_id.startsWith('concourse')) {
        if (zone.zone_id === 'concourse_c') {
          baseOcc = Math.min(95, baseOcc + (Math.random() * 12 + 4)); // Surging
          baseFlow = Math.round(280 + Math.random() * 50);
        } else {
          baseOcc = Math.min(85, baseOcc + (Math.random() * 8 + 2));
          baseFlow = Math.round(180 + Math.random() * 40);
        }
      } else if (zone.zone_id.startsWith('gate')) {
        baseOcc = Math.max(10, baseOcc - (Math.random() * 3 + 1)); // Gates empty during match
        baseFlow = Math.round(5 + Math.random() * 10);
      } else {
        baseOcc = Math.max(5, baseOcc + (Math.random() * 2 - 1));
        baseFlow = Math.round(5 + Math.random() * 10);
      }
    } else if (simulationPreset === 'gate_closure') {
      // Gate 3 security incident (Gate 3 closes, Gate 4 takes the overflow)
      if (zone.zone_id === 'gate_3') {
        baseOcc = Math.min(92, baseOcc + (Math.random() * 15 + 5)); // Surge due to block
        baseFlow = Math.round(5 + Math.random() * 5); // Drops to zero exit flow
      } else if (zone.zone_id === 'gate_4') {
        baseOcc = Math.min(82, baseOcc + (Math.random() * 10 + 3)); // Surging due to overflow
        baseFlow = Math.round(160 + Math.random() * 30);
      } else if (zone.zone_id.startsWith('concourse')) {
        baseOcc = Math.max(15, Math.min(30, baseOcc + (Math.random() * 4 - 2)));
        baseFlow = Math.round(15 + Math.random() * 15);
      }
    } else if (simulationPreset === 'exit_surge') {
      // Exit Surge (Gates and Transit Hubs surge)
      if (zone.zone_id.startsWith('transit')) {
        if (zone.zone_id === 'transit_hub_x') {
          baseOcc = Math.min(96, baseOcc + (Math.random() * 14 + 6)); // Light rail massive surge
          baseFlow = Math.round(420 + Math.random() * 80);
        } else {
          baseOcc = Math.min(88, baseOcc + (Math.random() * 10 + 4));
          baseFlow = Math.round(260 + Math.random() * 40);
        }
      } else if (zone.zone_id.startsWith('gate')) {
        baseOcc = Math.min(75, baseOcc + (Math.random() * 8 + 2));
        baseFlow = Math.round(150 + Math.random() * 30);
      } else if (zone.zone_id.startsWith('concourse')) {
        baseOcc = Math.max(25, baseOcc - (Math.random() * 5 + 1));
        baseFlow = Math.round(50 + Math.random() * 20);
      }
    }

    zone.occupancy_pct = Math.round(baseOcc);
    zone.flow_rate = Math.round(baseFlow);

    // Calculate trend based on history
    const lastVal = zone.history[zone.history.length - 1] || baseOcc;
    if (zone.occupancy_pct > lastVal + 2) {
      zone.trend = 'increasing';
    } else if (zone.occupancy_pct < lastVal - 2) {
      zone.trend = 'decreasing';
    } else {
      zone.trend = 'stable';
    }

    // Keep history at 3 entries
    zone.history.push(zone.occupancy_pct);
    if (zone.history.length > 3) {
      zone.history.shift();
    }

    // Update mathematical fallback values (will be overwritten if Gemini runs)
    if (zone.occupancy_pct > 80) {
      zone.risk_label = 'critical';
      zone.risk_score = +(zone.occupancy_pct / 100).toFixed(2);
    } else if (zone.occupancy_pct > 55) {
      zone.risk_label = 'elevated';
      zone.risk_score = +(zone.occupancy_pct / 100).toFixed(2);
    } else {
      zone.risk_label = 'normal';
      zone.risk_score = +(zone.occupancy_pct / 100).toFixed(2);
      zone.explanation = 'Flow is stable and processing normally.';
      zone.recommended_action = 'Maintain current staffing.';
      zone.staffing_reallocation = 'None needed.';
      zone.fan_facing_message = `${zone.name} is clear and flowing normally.`;
      zone.eta_to_critical_minutes = -1;
    }
  });
}

// Trigger reasoning loop for all zones (runs evaluateSurgingZonesWithAI on surging ones in batch)
async function triggerGeminiReasoningLoop() {
  console.log('Running Gemini Reasoning loop on stadium zones...');
  
  const surgingZones = [];
  zones.forEach(zone => {
    const isHighRiskPresetZone = 
      (simulationPreset === 'halftime' && zone.zone_id.startsWith('concourse')) ||
      (simulationPreset === 'gate_closure' && (zone.zone_id === 'gate_3' || zone.zone_id === 'gate_4')) ||
      (simulationPreset === 'exit_surge' && zone.zone_id.startsWith('transit'));

    if (zone.occupancy_pct > 60 || zone.flow_rate > 120 || isHighRiskPresetZone) {
      surgingZones.push(zone);
    } else {
      // Normal baseline resets
      zone.risk_score = +(zone.occupancy_pct / 100).toFixed(2);
      zone.risk_label = 'normal';
      zone.explanation = 'Flow is stable and processing normally.';
      zone.recommended_action = 'Maintain current staffing.';
      zone.staffing_reallocation = 'None needed.';
      zone.fan_facing_message = `${zone.name} is clear and flowing normally.`;
      zone.eta_to_critical_minutes = -1;
    }
  });

  if (surgingZones.length > 0) {
    await evaluateSurgingZonesWithAI(surgingZones);
  }
  console.log('Gemini Reasoning loop completed.');
}

// Polling interval for sensor updates (every 10 seconds)
setInterval(async () => {
  runSensorSimulationStep();
  // Note: To protect the user's 20 requests/day free-tier API quota, we do not call the AI reasoning loop automatically on every 10s tick.
  // Instead, the frontend uses cached assessments, or triggers on-demand updates during preset changes.
}, 10000);

// API: Get Stadium State
app.get('/api/stadium-state', (req, res) => {
  res.json({
    zones,
    activeDispatches,
    auditLog,
    simulationPreset,
    timestamp: new Date().toISOString()
  });
});

// API: Trigger Event Simulation Presets
app.post('/api/simulate-event', async (req, res) => {
  const { preset } = req.body;
  if (!['normal', 'halftime', 'gate_closure', 'exit_surge'].includes(preset)) {
    return res.status(400).json({ error: 'Invalid preset type' });
  }

  simulationPreset = preset;
  console.log(`Simulation preset changed to: ${preset}`);

  // Hard set initial values for the preset to make changes instant for demo
  zones.forEach(zone => {
    if (preset === 'normal') {
      zone.occupancy_pct = zone.zone_id.startsWith('gate') ? 22 : (zone.zone_id.startsWith('concourse') ? 18 : 12);
      zone.flow_rate = 30;
      zone.trend = 'stable';
      zone.history = [zone.occupancy_pct, zone.occupancy_pct, zone.occupancy_pct];
    } else if (preset === 'halftime') {
      if (zone.zone_id === 'concourse_c') {
        zone.occupancy_pct = 75;
        zone.flow_rate = 260;
      } else if (zone.zone_id.startsWith('concourse')) {
        zone.occupancy_pct = 65;
        zone.flow_rate = 170;
      } else {
        zone.occupancy_pct = 15;
        zone.flow_rate = 15;
      }
      zone.trend = 'increasing';
      zone.history = [zone.occupancy_pct - 10, zone.occupancy_pct - 5, zone.occupancy_pct];
    } else if (preset === 'gate_closure') {
      if (zone.zone_id === 'gate_3') {
        zone.occupancy_pct = 68;
        zone.flow_rate = 10;
      } else if (zone.zone_id === 'gate_4') {
        zone.occupancy_pct = 55;
        zone.flow_rate = 140;
      } else {
        zone.occupancy_pct = 20;
        zone.flow_rate = 30;
      }
      zone.trend = 'increasing';
      zone.history = [zone.occupancy_pct - 8, zone.occupancy_pct - 4, zone.occupancy_pct];
    } else if (preset === 'exit_surge') {
      if (zone.zone_id === 'transit_hub_x') {
        zone.occupancy_pct = 72;
        zone.flow_rate = 380;
      } else if (zone.zone_id === 'transit_hub_y') {
        zone.occupancy_pct = 60;
        zone.flow_rate = 220;
      } else if (zone.zone_id.startsWith('gate')) {
        zone.occupancy_pct = 50;
        zone.flow_rate = 160;
      } else {
        zone.occupancy_pct = 30;
        zone.flow_rate = 60;
      }
      zone.trend = 'increasing';
      zone.history = [zone.occupancy_pct - 10, zone.occupancy_pct - 5, zone.occupancy_pct];
    }
  });

  // Instantly run reasoning
  await triggerGeminiReasoningLoop();
  
  // Reset active dispatches upon preset change to clear demo state
  activeDispatches = [];

  // Append to audit log
  auditLog.unshift({
    event_id: 'preset_' + Date.now(),
    type: 'preset',
    message: `Preset scenario changed to: ${preset.toUpperCase()}`,
    timestamp: new Date().toLocaleTimeString()
  });
  if (auditLog.length > 20) auditLog.pop();

  res.json({
    message: `Preset successfully changed to ${preset}. Sensor data simulated.`,
    zones,
    activeDispatches,
    auditLog
  });
});

// API: Dispatch Operational Recommendations (Closed-Loop Ops)
app.post('/api/dispatch', (req, res) => {
  const { zone_id, action_text, staffing_reallocation_text } = req.body;
  const targetZone = zones.find(z => z.zone_id === zone_id);

  if (!targetZone) {
    return res.status(404).json({ error: 'Zone not found' });
  }

  // Create dispatch item
  const dispatchItem = {
    dispatch_id: 'disp_' + Date.now(),
    zone_id,
    zone_name: targetZone.name,
    risk_label: targetZone.risk_label,
    action_text,
    staffing_reallocation_text,
    timestamp: new Date().toLocaleTimeString(),
    acknowledged: false
  };

  activeDispatches.push(dispatchItem);

  // Apply staffing reallocation to the active zones list directly to reflect changes
  if (staffing_reallocation_text && staffing_reallocation_text.toLowerCase() !== 'none needed.') {
    // Attempt simple extraction: e.g. "Reallocate 4 staff from Gate 1 to Gate 3"
    const match = staffing_reallocation_text.match(/reallocate\s+(\d+)\s+(?:staff|volunteers)?\s*from\s+([\w\s\d()\-]+)\s+to\s+([\w\s\d()\-]+)/i);
    if (match) {
      const quantity = parseInt(match[1]);
      const donorNameSegment = match[2].toLowerCase();
      const recipientNameSegment = match[3].toLowerCase();

      const donorZone = zones.find(z => z.name.toLowerCase().includes(donorNameSegment) || z.zone_id.toLowerCase().includes(donorNameSegment));
      const recipientZone = zones.find(z => z.name.toLowerCase().includes(recipientNameSegment) || z.zone_id.toLowerCase().includes(recipientNameSegment));

      if (donorZone && recipientZone) {
        const actualShift = Math.min(donorZone.current_staff, quantity);
        donorZone.current_staff -= actualShift;
        recipientZone.current_staff += actualShift;
        console.log(`Applied staffing change: shifted ${actualShift} staff from ${donorZone.zone_id} to ${recipientZone.zone_id}`);
      }
    }
  }

  // Append to audit log
  auditLog.unshift({
    event_id: 'disp_' + Date.now(),
    type: 'dispatch',
    message: `Dispatched action for ${targetZone.name}: ${action_text.slice(0, 50)}...`,
    timestamp: new Date().toLocaleTimeString()
  });
  if (auditLog.length > 20) auditLog.pop();

  res.json({
    message: 'Operational recommendations successfully dispatched.',
    activeDispatches,
    zones,
    auditLog
  });
});

// API: Acknowledge/Resolve Volunteer Action
app.post('/api/acknowledge', (req, res) => {
  const { dispatch_id } = req.body;
  const idx = activeDispatches.findIndex(d => d.dispatch_id === dispatch_id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Active dispatch not found' });
  }

  const dispatch = activeDispatches[idx];
  dispatch.acknowledged = true;
  
  // Remove after a brief period or remove instantly to simulate resolved
  activeDispatches.splice(idx, 1);

  // Automatically adjust risk down slightly as dynamic mitigation is applied
  const affectedZone = zones.find(z => z.zone_id === dispatch.zone_id);
  if (affectedZone) {
    affectedZone.occupancy_pct = Math.max(25, affectedZone.occupancy_pct - 15);
    affectedZone.flow_rate = Math.max(30, affectedZone.flow_rate - 80);
    affectedZone.risk_label = 'normal';
    affectedZone.risk_score = +(affectedZone.occupancy_pct / 100).toFixed(2);
    affectedZone.explanation = 'Crowd control countermeasures deployed by field volunteers.';
    affectedZone.recommended_action = 'Maintain current staffing.';
    affectedZone.staffing_reallocation = 'None needed.';
    affectedZone.fan_facing_message = `${affectedZone.name} has cleared up. Access is normal.`;
  }

  // Append to audit log
  auditLog.unshift({
    event_id: 'resolv_' + Date.now(),
    type: 'resolution',
    message: `Alert resolved at ${dispatch.zone_name} by field team.`,
    timestamp: new Date().toLocaleTimeString()
  });
  if (auditLog.length > 20) auditLog.pop();

  res.json({
    message: 'Action completed. Stadium crowd flow successfully mitigated.',
    activeDispatches,
    zones
  });
});

// API: Incident Summary Rollup Report for Ops Manager
app.get('/api/incident-summary', async (req, res) => {
  try {
    const activeAlerts = zones.filter(z => z.risk_label !== 'normal');
    const alertsString = activeAlerts.map(a => `${a.name}: Occupancy ${a.occupancy_pct}%, Risk: ${a.risk_label}, Action: ${a.recommended_action}`).join('\n') || 'None. All stadium zones operating within normal parameters.';
    const dispatchesString = activeDispatches.map(d => `[${d.zone_name}] Action: ${d.action_text}`).join('\n') || 'No active dispatches.';

    const prompt = `
You are the Chief Operations Officer of StadiumPulse AI for FIFA World Cup 2026.
Review the current stadium status of all 10 zones:
Active Simulation Preset: ${simulationPreset}

High-Risk Areas:
${alertsString}

Active Dispatches:
${dispatchesString}

Generate a premium, concise executive briefing (2 paragraphs maximum) summarizing:
1. Current operational status (normal, halftime rush, gate incident, exit surge).
2. The most critical crowd flow bottleneck, explaining the cause.
3. Active countermeasures and staffing status.
Use professional stadium-operations jargon (e.g. egress, ingress, crowd control, staffing optimization, bottlenecks). Use bullet points for key metrics (e.g., average occupancy, total active incidents).
    `;

    const responseText = await callAIModel(prompt);
    latestIncidentSummary = responseText;
    res.json({ summary: latestIncidentSummary });
  } catch (error) {
    console.error('Error generating incident summary:', error);
    res.json({ summary: 'Stadium Operations: Status is stable. Moderate foot traffic observed in concourses. Entry gates processing normal load.' });
  }
});

// API: Fan Concierge Chat (Simulated Grounding/RAG)
app.post('/api/chat', async (req, res) => {
  const { message, language, section } = req.body;
  const lang = language || 'English';

  // Retrieve current active congestion warnings to ground the response
  const congestedZones = zones.filter(z => z.risk_label !== 'normal');
  const congestionGrounding = congestedZones.map(z => `WARNING: ${z.name} is currently experiencing ${z.risk_label} congestion (${z.occupancy_pct}% full). Fan message: "${z.fan_facing_message}"`).join('\n') || 'All gates and concourses are currently clear and flowing smoothly.';

  // Build the stadium guide context
  const guideContext = `
STADIUM GUIDE GROUNDING DATA:
- Seating Sections:
  * Sections 100-110: Closest to Gate 1 (North Entrance)
  * Sections 111-125: Closest to Gate 2 (East Entrance)
  * Sections 200-215: Closest to Gate 3 (South Entrance)
  * Sections 216-230: Closest to Gate 4 (West Entrance)
- Public Transit Options:
  * Transit Hub X (Light Rail Station): Located directly outside the North Gate (Gate 1). Best for fast travel downtown.
  * Transit Hub Y (Shuttle Bus Terminal): Located outside the South Gate (Gate 3). Direct shuttles to public parking and airport.
- Security Rules:
  * Small bags only (under A4 size, 21x30cm max).
  * No professional cameras or recording equipment allowed.
  * No outside food/beverages.
  * Gates open exactly 3 hours before kickoff.
- Current Real-time Crowd Congestion Warnings:
${congestionGrounding}
  `;

  try {
    const prompt = `
You are the StadiumPulse AI fan concierge for the FIFA World Cup 2026.
You must help the fan navigate the venue, answer security/transit questions, and guide them around congestion.
Respond in: ${lang}.
The user is sitting in/heading to Section: ${section || 'General Admission'}.

Use the following grounding context to construct a accurate, helpful response. 
If the user asks about going to a congested area, proactively warn them and recommend an alternative route or gate based on the Seating Sections mapping.

${guideContext}

User Query: "${message}"

Write a warm, concise, conversational response. Keep it under 4 paragraphs. Format key details with bullet points.
    `;

    const responseText = await callAIModel(prompt);

    // Append to audit log
    auditLog.unshift({
      event_id: 'chat_' + Date.now(),
      type: 'chat',
      message: `Fan inquiry processed regarding ${section || 'General'}.`,
      timestamp: new Date().toLocaleTimeString()
    });
    if (auditLog.length > 20) auditLog.pop();

    res.json({ response: responseText });
  } catch (error) {
    console.error('Error in Fan Chat:', error);
    res.json({ response: 'I am currently having difficulty connecting to my reasoning node. Please consult stadium volunteers for assistance.' });
  }
});

// API: Generate Multilingual Broadcasts Package via Gemini
app.post('/api/generate-broadcasts', async (req, res) => {
  const { zone_id } = req.body;
  const zone = zones.find(z => z.zone_id === zone_id);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });

  try {
    const prompt = `
You are the StadiumPulse AI communications director for the FIFA World Cup 2026.
A congestion incident is active at Zone: ${zone.name} (${zone.zone_id}).
Current occupancy: ${zone.occupancy_pct}%, Flow rate: ${zone.flow_rate} people/minute.
Recommended action: "${zone.recommended_action}".
Fan message: "${zone.fan_facing_message}".

Generate a broadcast package for this incident. You must return a JSON response containing:
1. "pa_audio_script": A professional PA (Public Address) system speaker script (in English) that the stadium announcer can read. Must sound authoritative, calm, and clear.
2. "push_notifications": An object containing translated mobile app push alerts (under 120 chars each) in:
   - "en": English
   - "es": Spanish
   - "fr": French
   - "pt": Portuguese
    `;

    const responseText = await callAIModel(prompt, true, {
      type: "object",
      properties: {
        pa_audio_script: { type: "string" },
        push_notifications: {
          type: "object",
          properties: {
            en: { type: "string" },
            es: { type: "string" },
            fr: { type: "string" },
            pt: { type: "string" }
          },
          required: ["en", "es", "fr", "pt"]
        }
      },
      required: ["pa_audio_script", "push_notifications"]
    });

    const parsed = JSON.parse(responseText);

    // Append to audit log
    auditLog.unshift({
      event_id: 'brdcst_' + Date.now(),
      type: 'broadcast',
      message: `Broadcast package generated for ${zone.name}.`,
      timestamp: new Date().toLocaleTimeString()
    });
    if (auditLog.length > 20) auditLog.pop();

    res.json(parsed);
  } catch (error) {
    console.error('Error generating broadcasts:', error);
    res.json({
      pa_audio_script: `Attention fans in ${zone.name}: We are experiencing heavy pedestrian flow. Please follow volunteer instructions and utilize adjacent concourses if possible.`,
      push_notifications: {
        en: `Alert: High crowd density in ${zone.name}. Please follow signs to alternate exits.`,
        es: `Alerta: Alta densidad en ${zone.name}. Por favor siga las señales hacia salidas alternativas.`,
        fr: `Alerte: Forte affluence dans ${zone.name}. Veuillez suivre les panneaux vers les sorties alternatives.`,
        pt: `Alerta: Alta densidade em ${zone.name}. Por favor siga as placas para saídas alternativas.`
      }
    });
  }
});

// Serve frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`StadiumPulse AI Server running on port ${PORT}`);
});
