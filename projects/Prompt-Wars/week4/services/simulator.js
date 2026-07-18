// StadiumPulse AI — Simulation & State Service
import { initialZones } from '../data/zones.js';
import { callGemini } from './gemini.js';

export let zones = JSON.parse(JSON.stringify(initialZones));
export let activeDispatches = [];
export let auditLog = [
  {
    event_id: 'init_' + Date.now(),
    type: 'preset',
    message: 'StadiumPulse AI core operations engine booted.',
    timestamp: new Date().toLocaleTimeString()
  }
];
export let simulationPreset = 'normal';

// JSON Schema for structured Gemini assessments
const riskSchema = {
  type: "object",
  properties: {
    zone_id: { type: "string" },
    risk_score: { type: "number" },
    risk_label: { type: "string" },
    eta_to_critical_minutes: { type: "integer" },
    explanation: { type: "string" },
    recommended_action: { type: "string" },
    staffing_reallocation: { type: "string" },
    fan_facing_message: { type: "string" },
    confidence_score: { type: "integer" },
    predicted_impact: { type: "string" }
  },
  required: [
    "zone_id",
    "risk_score",
    "risk_label",
    "eta_to_critical_minutes",
    "explanation",
    "recommended_action",
    "staffing_reallocation",
    "fan_facing_message",
    "confidence_score",
    "predicted_impact"
  ]
};

const responseSchema = {
  type: "object",
  properties: {
    assessments: {
      type: "array",
      items: riskSchema
    }
  },
  required: ["assessments"]
};

// Periodic background simulation loop
export function runSensorSimulationStep() {
  zones.forEach(zone => {
    let baseOcc = zone.occupancy_pct;
    let baseFlow = zone.flow_rate;

    if (simulationPreset === 'normal') {
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
      zone.trend = Math.random() > 0.6 ? 'stable' : (Math.random() > 0.5 ? 'increasing' : 'decreasing');
    } else if (simulationPreset === 'halftime') {
      if (zone.zone_id.startsWith('concourse')) {
        if (zone.zone_id === 'concourse_c') {
          baseOcc = Math.min(95, baseOcc + (Math.random() * 12 + 4));
          baseFlow = Math.round(280 + Math.random() * 50);
          zone.trend = 'increasing';
        } else {
          baseOcc = Math.min(85, baseOcc + (Math.random() * 8 + 2));
          baseFlow = Math.round(180 + Math.random() * 40);
          zone.trend = 'increasing';
        }
      } else if (zone.zone_id.startsWith('gate')) {
        baseOcc = Math.max(10, baseOcc - (Math.random() * 3 + 1));
        baseFlow = Math.round(5 + Math.random() * 10);
        zone.trend = 'decreasing';
      }
    } else if (simulationPreset === 'gate_closure') {
      // Gate 3 Outage, routing to Gate 4
      if (zone.zone_id === 'gate_3') {
        baseOcc = Math.min(92, baseOcc + (Math.random() * 15 + 5));
        baseFlow = Math.round(5 + Math.random() * 5);
        zone.trend = 'increasing';
      } else if (zone.zone_id === 'gate_4') {
        baseOcc = Math.min(82, baseOcc + (Math.random() * 10 + 3));
        baseFlow = Math.round(160 + Math.random() * 30);
        zone.trend = 'increasing';
      }
    } else if (simulationPreset === 'exit_surge') {
      // Exit Surge: Transit Hub X breakdown, routing to Y
      if (zone.zone_id === 'transit_hub_x') {
        baseOcc = Math.min(96, baseOcc + (Math.random() * 14 + 6));
        baseFlow = Math.round(420 + Math.random() * 80);
        zone.trend = 'increasing';
      } else if (zone.zone_id === 'transit_hub_y') {
        baseOcc = Math.min(88, baseOcc + (Math.random() * 10 + 4));
        baseFlow = Math.round(260 + Math.random() * 40);
        zone.trend = 'increasing';
      } else if (zone.zone_id.startsWith('gate')) {
        baseOcc = Math.min(75, baseOcc + (Math.random() * 8 + 2));
        baseFlow = Math.round(120 + Math.random() * 30);
        zone.trend = 'increasing';
      }
    }

    zone.occupancy_pct = Math.round(baseOcc);
    zone.flow_rate = Math.round(baseFlow);
  });

  // Automatically trigger batch AI assessment for surging zones
  const surging = zones.filter(z => z.occupancy_pct > 45 || z.risk_label !== 'normal');
  if (surging.length > 0) {
    evaluateSurgingZonesWithAI(surging);
  }
}

// Evaluate surging zones using direct Gemini call
export async function evaluateSurgingZonesWithAI(surgingZones) {
  try {
    const zonesDataString = surgingZones.map(z => `
- Zone ID: ${z.zone_id}
  Name: ${z.name}
  Occupancy: ${z.occupancy_pct}%
  Flow rate: ${z.flow_rate} p/min
  Current Staff: ${z.current_staff} volunteers
  Trend: ${z.trend}
    `).join('\n');

    const prompt = `
You are the StadiumPulse AI crowd reasoning agent for the FIFA World Cup 2026.
You are evaluating the following surging/high-risk zones in the stadium:

${zonesDataString}

Active Preset Scenario: ${simulationPreset}

For each zone listed, evaluate the crowd density and flow risk.
You must output a JSON response containing an 'assessments' array of objects conforming to the schema.
For staffing reallocations, look to shift volunteers from zones that are under 30% occupancy.
    `;

    const systemInstruction = "Analyze real-time stadium congestion and output actionable multi-agency safety playbooks in JSON.";
    const responseText = await callGemini(prompt, systemInstruction, true, responseSchema);
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
          zone.confidence_score = assessment.confidence_score || 90;
          zone.predicted_impact = assessment.predicted_impact || "Delay spikes and potential crowd gridlocks.";
        }
      });
    }
  } catch (error) {
    console.error("Simulation AI evaluation failed. Running local fallback...", error);
    // Safe fallbacks to keep the app working even if there are quota limits
    surgingZones.forEach(zone => {
      zone.risk_score = +(zone.occupancy_pct / 100).toFixed(2);
      zone.risk_label = zone.occupancy_pct > 80 ? 'critical' : 'elevated';
      zone.confidence_score = 85;
      zone.predicted_impact = "Elevated crowd bottleneck at entrance lanes.";
    });
  }
}

// Update simulation preset
export async function setPreset(preset) {
  simulationPreset = preset;
  
  const labels = {
    normal: 'Normal Baseline Operations',
    halftime: 'Halftime Concourse Rush',
    gate_closure: 'Gate 3 Ticketing Outage',
    exit_surge: 'Transit Hub X breakdown / Post-Match Exit Surge'
  };

  auditLog.unshift({
    event_id: 'preset_' + Date.now(),
    type: 'preset',
    message: `Scenario changed: ${labels[preset] || preset}`,
    timestamp: new Date().toLocaleTimeString()
  });
  if (auditLog.length > 20) auditLog.pop();

  // Reset risk statuses on normal preset toggle
  if (preset === 'normal') {
    zones = JSON.parse(JSON.stringify(initialZones));
    activeDispatches = [];
  } else {
    // Elevate occupancy in specific zones to trigger initial assessments
    if (preset === 'halftime') {
      const zC = zones.find(z => z.zone_id === 'concourse_c');
      if (zC) { zC.occupancy_pct = 75; zC.flow_rate = 210; zC.risk_label = 'elevated'; }
    } else if (preset === 'gate_closure') {
      const zG = zones.find(z => z.zone_id === 'gate_3');
      if (zG) { zG.occupancy_pct = 85; zG.flow_rate = 12; zG.risk_label = 'critical'; }
    } else if (preset === 'exit_surge') {
      const zTx = zones.find(z => z.zone_id === 'transit_hub_x');
      if (zTx) { zTx.occupancy_pct = 90; zTx.flow_rate = 380; zTx.risk_label = 'critical'; }
    }
  }

  // Force sensor step evaluation immediately
  runSensorSimulationStep();
}
