// StadiumPulse AI — Express API Router with Secure Database & Rate Limiting
import express from 'express';
import jwt from 'jsonwebtoken';
import { zones, activeDispatches, auditLog, simulationPreset, setPreset } from '../services/simulator.js';
import { callGemini } from '../services/gemini.js';
import { db, verifyPassword, hashPassword } from '../services/database.js';
import { rateLimiter } from '../services/rateLimiter.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fifa-worldcup-2026-supersecret-token-key';

// Middleware: Authenticate REST API calls (returns JSON status codes)
export function authMiddleware(allowedRoles = []) {
  return (req, res, next) => {
    const token = req.cookies.auth_token;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required. Active session expired.' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;

      if (allowedRoles.length > 0 && !allowedRoles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Clearance denied. Insufficient role permissions.' });
      }

      next();
    } catch (err) {
      console.error("JWT parsing validation failed:", err);
      res.clearCookie('auth_token');
      return res.status(401).json({ error: 'Session signature invalid. Please authenticate again.' });
    }
  };
}

// Middleware: Authenticate browser page GET requests (redirects to /login)
export function pageAuth(role) {
  return (req, res, next) => {
    const token = req.cookies.auth_token;
    if (!token) {
      return res.redirect('/login');
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (role && decoded.role !== role) {
        return res.redirect('/login');
      }
      next();
    } catch (err) {
      res.clearCookie('auth_token');
      return res.redirect('/login');
    }
  };
}

// POST: Authenticate user login (Rate-limited: 5 requests / 15 mins)
router.post('/login', rateLimiter(5, 15 * 60 * 1000, 'Authentication Gate'), (req, res) => {
  const { username, password } = req.body;
  const user = db.findByUsername(username);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password credentials.' });
  }

  // Issue signed JWT session token
  const token = jwt.sign(
    { username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '2h' }
  );

  // Set secure, client-hidden HttpOnly session cookie
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 2 * 60 * 60 * 1000 // 2 hours
  });

  res.json({
    message: 'SSO Authentication successful.',
    username: user.username,
    role: user.role,
    name: user.name
  });
});

// POST: Register new user record (Rate-limited: 5 requests / 15 mins)
router.post('/register', rateLimiter(5, 15 * 60 * 1000, 'Registration Gate'), (req, res) => {
  const { username, password, role, name, securityQuestion, securityAnswer } = req.body;
  
  if (!username || !password || !role || !securityQuestion || !securityAnswer) {
    return res.status(400).json({ error: 'All registration parameters are required.' });
  }

  try {
    const newUser = db.createUser({
      username,
      password,
      role,
      name,
      securityQuestion,
      securityAnswer
    });

    res.json({
      message: `User '${newUser.username}' successfully registered with operational clearance '${newUser.role}'.`
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST: Retrieve security question (Rate-limited: 5 requests / 15 mins)
router.post('/forgot-question', rateLimiter(5, 15 * 60 * 1000, 'Forgot Password Retrieval'), (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username is required.' });

  const user = db.findByUsername(username);
  if (!user) {
    return res.status(404).json({ error: 'Username not found in operations registry.' });
  }

  res.json({ question: user.securityQuestion });
});

// POST: Verify security answer and reset password (Rate-limited: 5 requests / 15 mins)
router.post('/reset-password', rateLimiter(5, 15 * 60 * 1000, 'Password Reset Execution'), (req, res) => {
  const { username, answer, new_password } = req.body;
  if (!username || !answer || !new_password) {
    return res.status(400).json({ error: 'Username, answer, and new password are required.' });
  }

  const user = db.findByUsername(username);
  if (!user) {
    return res.status(404).json({ error: 'User record not found.' });
  }

  // Verify security answer match (hashed)
  const answerSanitized = answer.toLowerCase().trim();
  const isValidAnswer = verifyPassword(answerSanitized, user.securityAnswerHash);

  if (!isValidAnswer) {
    return res.status(401).json({ error: 'Incorrect security answer. Reset authorization denied.' });
  }

  try {
    db.updatePassword(username, new_password);
    res.json({ message: 'Password reset successful. You may now authenticate.' });
  } catch (err) {
    res.status(500).json({ error: 'Database transaction failed.' });
  }
});

// POST: Log out and clear session cookie
router.post('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ message: 'Session successfully cleared. Redirecting...' });
});

// GET: Current live stadium state (Rate-limited: 100 requests / 15 mins)
router.get('/stadium-state', rateLimiter(100, 15 * 60 * 1000, 'Global API'), (req, res) => {
  res.json({
    zones,
    activeDispatches,
    auditLog,
    simulationPreset
  });
});

// POST: Trigger simulation scenario preset (Dev tool)
router.post('/simulate-event', rateLimiter(100, 15 * 60 * 1000, 'Global API'), async (req, res) => {
  const { preset } = req.body;
  if (!preset) return res.status(400).json({ error: 'Preset name is required.' });
  
  await setPreset(preset);
  res.json({
    message: `Scenario '${preset}' successfully injected.`,
    zones,
    activeDispatches,
    auditLog,
    simulationPreset
  });
});

// POST: Transmit operational dispatch order (Protected: Operations Leads only)
router.post('/dispatch-action', authMiddleware(['ops']), rateLimiter(100, 15 * 60 * 1000, 'Global API'), (req, res) => {
  const { zone_id, action_text, staffing_reallocation_text } = req.body;
  const targetZone = zones.find(z => z.zone_id === zone_id);

  if (!targetZone) {
    return res.status(404).json({ error: 'Target zone not found.' });
  }

  const dispatchItem = {
    dispatch_id: 'disp_' + Date.now(),
    zone_id,
    zone_name: targetZone.name,
    action_text,
    staffing_reallocation_text,
    acknowledged: false,
    timestamp: new Date().toLocaleTimeString()
  };

  activeDispatches.push(dispatchItem);

  // Apply staffing shift
  if (staffing_reallocation_text && staffing_reallocation_text.toLowerCase() !== 'none needed.') {
    const match = staffing_reallocation_text.match(/reallocate\s+(\d+)\s+staff\s+from\s+([\w_]+)/i);
    if (match) {
      const quantity = parseInt(match[1]);
      const donorId = match[2].trim();
      const donorZone = zones.find(z => z.zone_id === donorId);
      if (donorZone) {
        const shifted = Math.min(donorZone.current_staff, quantity);
        donorZone.current_staff -= shifted;
        targetZone.current_staff += shifted;
      }
    }
  }

  auditLog.unshift({
    event_id: 'disp_log_' + Date.now(),
    type: 'dispatch',
    message: `Ops dispatched command for ${targetZone.name}: "${action_text.slice(0, 45)}..."`,
    timestamp: new Date().toLocaleTimeString()
  });
  if (auditLog.length > 20) auditLog.pop();

  res.json({
    message: 'Mitigation dispatch transmitted to field volunteers.',
    activeDispatches,
    zones,
    auditLog
  });
});

// POST: Acknowledge/Resolve active dispatch (Protected: Staff only)
router.post('/acknowledge', authMiddleware(['volunteer']), rateLimiter(100, 15 * 60 * 1000, 'Global API'), (req, res) => {
  const { dispatch_id } = req.body;
  const idx = activeDispatches.findIndex(d => d.dispatch_id === dispatch_id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Active dispatch directive not found.' });
  }

  const dispatch = activeDispatches[idx];
  activeDispatches.splice(idx, 1);

  // Lower risk metrics on zone resolution
  const affectedZone = zones.find(z => z.zone_id === dispatch.zone_id);
  if (affectedZone) {
    affectedZone.occupancy_pct = Math.max(25, affectedZone.occupancy_pct - 20);
    affectedZone.flow_rate = Math.max(30, affectedZone.flow_rate - 75);
    affectedZone.risk_label = 'normal';
    affectedZone.risk_score = +(affectedZone.occupancy_pct / 100).toFixed(2);
    affectedZone.explanation = 'Crowd control countermeasures deployed by field volunteers.';
    affectedZone.recommended_action = 'Maintain current staffing.';
    affectedZone.staffing_reallocation = 'None needed.';
    affectedZone.fan_facing_message = 'Access is normal. Ingress clear.';
  }

  auditLog.unshift({
    event_id: 'resolv_log_' + Date.now(),
    type: 'resolution',
    message: `Alert resolved at ${dispatch.zone_name} by field team.`,
    timestamp: new Date().toLocaleTimeString()
  });
  if (auditLog.length > 20) auditLog.pop();

  res.json({
    message: 'Dispatch directive acknowledged and resolved.',
    activeDispatches,
    zones,
    auditLog
  });
});

// POST: Report Crowd Incident from Mobile Volunteers (Protected: Staff only)
router.post('/report-incident', authMiddleware(['volunteer']), rateLimiter(100, 15 * 60 * 1000, 'Global API'), (req, res) => {
  const { zone_id, incident_description, severity } = req.body;
  const targetZone = zones.find(z => z.zone_id === zone_id);

  if (!targetZone) {
    return res.status(404).json({ error: 'Zone location not found.' });
  }

  targetZone.risk_label = severity || 'elevated';
  targetZone.occupancy_pct = severity === 'critical' ? 86 : 62;
  targetZone.flow_rate = severity === 'critical' ? 240 : 130;
  targetZone.trend = 'increasing';
  targetZone.risk_score = +(targetZone.occupancy_pct / 100).toFixed(2);
  targetZone.explanation = incident_description || `Volunteers flagged an active surge incident.`;
  targetZone.recommended_action = severity === 'critical' 
    ? 'Deploy rapid-response crowd monitors and open backup overflow gates.' 
    : 'Increase staff counts at security lanes and monitor queues.';
  targetZone.confidence_score = 95;
  targetZone.predicted_impact = severity === 'critical' 
    ? 'Safety blockage outside ticketing turnstiles within 10 minutes.' 
    : 'Local corridors will experience bottleneck gridlock.';

  auditLog.unshift({
    event_id: 'report_log_' + Date.now(),
    type: 'dispatch',
    message: `Incident reported at ${targetZone.name} by staff: ${incident_description}`,
    timestamp: new Date().toLocaleTimeString()
  });
  if (auditLog.length > 20) auditLog.pop();

  res.json({
    message: 'Field incident report logged and transmitted to command room.',
    zones,
    auditLog
  });
});

// GET: Executive operations brief (Protected: Operations Leads only. Rate Limited: 15 / 15 mins)
router.get('/incident-summary', authMiddleware(['ops']), rateLimiter(15, 15 * 60 * 1000, 'Gemini Operations Briefing'), async (req, res) => {
  try {
    const riskZones = zones.filter(z => z.risk_label !== 'normal');
    let zonesDescription = "All zones operating normally at nominal capacity limits.";
    
    if (riskZones.length > 0) {
      zonesDescription = riskZones.map(z => `
- Zone: ${z.name}
  Density status: ${z.risk_label.toUpperCase()} (${z.occupancy_pct}% Occupancy)
  Incident alert: ${z.explanation}
  Proposed dispatch directive: ${z.recommended_action}
      `).join('\n');
    }

    const prompt = `
You are the Executive Tournament Director for the FIFA World Cup 2026.
Synthesize a high-level briefing summarizing the stadium operations.

Current Status:
${zonesDescription}

Active Preset Scenario: ${simulationPreset}

Format your summary in clean markdown using headers and brief bullets describing:
1. Active Bottlenecks & Safety Warnings
2. Coordinated Action Directive Playbook
3. Forecasted Traffic Projections
Ensure the response is concise and directly actionable for SRE and crowd safety commanders.
    `;

    const systemInstruction = "Draft concise FIFA operations command briefs based on live telemetry.";
    const summaryText = await callGemini(prompt, systemInstruction);
    res.json({ summary: summaryText });
  } catch (error) {
    console.error("Failed to generate incident briefing summary:", error);
    res.json({
      summary: `### Operational Briefing (Fallback)
*   **Active Status**: Match day ingress processing normally.
*   **Actionable Directives**: Continue monitoring entrance lanes and transit shuttles.`
    });
  }
});

// POST: Interactive conversational assistant (Rate Limited: 15 / 15 mins)
router.post('/chat', rateLimiter(15, 15 * 60 * 1000, 'Gemini Chat Support'), async (req, res) => {
  const { message, language, section } = req.body;
  if (!message) return res.status(400).json({ error: 'Message query is required.' });

  try {
    const activeRiskZones = zones.filter(z => z.risk_label !== 'normal');
    const riskData = activeRiskZones.map(z => `${z.name} status is ${z.risk_label} with ${z.occupancy_pct}% load. Recommended action: ${z.recommended_action}`).join('. ');

    const prompt = `
Context:
- We are operating a FIFA World Cup 2026 Stadium.
- Active dispatches: ${JSON.stringify(activeDispatches)}
- Surging zones: ${riskData || 'None. All sectors flowing smoothly.'}
- Target User Section: Section ${section || 'General'}
- Preferred language: ${language || 'English'}

User Query: "${message}"

Formulate a helpful response in the user's preferred language. If they are staff/operators, provide clear technical steps. If they are a spectator, be welcoming, direct, and guide them around crowd bottlenecks. Keep formatting simple.
    `;

    const systemInstruction = "You are the StadiumPulse AI Concierge and Operations Co-Pilot, powered by Google Gemini.";
    const reply = await callGemini(prompt, systemInstruction);
    res.json({ response: reply });
  } catch (error) {
    console.error("Chat service error:", error);
    res.json({ response: "Apologies, the stadium communications grid is currently experiencing heavy load. Please stand by." });
  }
});

// POST: Generate announcement scripts (Protected: Operations Leads only. Rate Limited: 15 / 15 mins)
router.post('/generate-broadcasts', authMiddleware(['ops']), rateLimiter(15, 15 * 60 * 1000, 'Gemini Broadcast Generation'), async (req, res) => {
  const { zone_id } = req.body;
  const zone = zones.find(z => z.zone_id === zone_id);

  if (!zone) return res.status(404).json({ error: 'Zone location not found.' });

  try {
    const prompt = `
Draft emergency broadcasts for the stadium sector: ${zone.name}.
Current condition: ${zone.explanation}
Severity level: ${zone.risk_label.toUpperCase()}

Generate a JSON object conforming exactly to this structure:
{
  "pa_audio_script": "announcer PA script to read aloud in English",
  "push_notifications": {
    "en": "English app push alert text",
    "es": "Spanish app push alert text",
    "fr": "French app push alert text",
    "pt": "Portuguese app push alert text"
  }
}
    `;

    const responseSchema = {
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
    };

    const reply = await callGemini(prompt, '', true, responseSchema);
    res.json(JSON.parse(reply));
  } catch (error) {
    console.error("Failed to generate broadcast translations:", error);
    res.json({
      pa_audio_script: `Attention spectators in ${zone.name}: We are experiencing ingress surges. Please utilize adjacent gates for rapid entry.`,
      push_notifications: {
        en: `Congestion warning at ${zone.name}. Redirecting traffic.`,
        es: `Advertencia de congestión en ${zone.name}. Reruteando tráfico.`,
        fr: `Avis de congestion à ${zone.name}. Reroutage du trafic.`,
        pt: `Aviso de congestionamento em ${zone.name}. Roteamento do tráfego.`
      }
    });
  }
});

// POST: Generate Playbook (Protected: Operations Leads only. Rate Limited: 15 / 15 mins)
router.post('/generate-playbook', authMiddleware(['ops']), rateLimiter(15, 15 * 60 * 1000, 'Gemini Playbook Generation'), async (req, res) => {
  const { incident_type, zone_id } = req.body;
  const zone = zones.find(z => z.zone_id === zone_id);
  const zoneName = zone ? zone.name : 'Unknown Stadium Sector';

  try {
    const prompt = `
Generate a FIFA Coordinated Emergency Playbook for the following incident:
- Incident Type: ${incident_type}
- Stadium Zone: ${zoneName}

We need to coordinate operations across four agencies:
1. FIFA Stadium Stewards (Crowd monitors, egress guides)
2. Safety & Security Command (Police, entrance barriers)
3. Medical Dispatch (First aid responders, emergency corridors)
4. Local Transit Authority (Bus frequencies, light rail schedules)

Use standard tournament safety regulations (FIFA Safety SOPs) to draft specific, structured task directives for each agency.
Output a JSON response matching this schema:
{
  "playbook_title": "string",
  "severity": "CRITICAL" | "ELEVATED",
  "fifa_stewards_directives": ["bullet 1", "bullet 2"],
  "security_command_directives": ["bullet 1", "bullet 2"],
  "medical_dispatch_directives": ["bullet 1", "bullet 2"],
  "transit_authority_directives": ["bullet 1", "bullet 2"],
  "predicted_resolution_time_minutes": 15
}
    `;

    const playbookSchema = {
      type: "object",
      properties: {
        playbook_title: { type: "string" },
        severity: { type: "string" },
        fifa_stewards_directives: { type: "array", items: { type: "string" } },
        security_command_directives: { type: "array", items: { type: "string" } },
        medical_dispatch_directives: { type: "array", items: { type: "string" } },
        transit_authority_directives: { type: "array", items: { type: "string" } },
        predicted_resolution_time_minutes: { type: "integer" }
      },
      required: [
        "playbook_title",
        "severity",
        "fifa_stewards_directives",
        "security_command_directives",
        "medical_dispatch_directives",
        "transit_authority_directives",
        "predicted_resolution_time_minutes"
      ]
    };

    const reply = await callGemini(prompt, 'You generate structured multi-agency playbooks.', true, playbookSchema);
    res.json(JSON.parse(reply));
  } catch (error) {
    console.error("Failed to generate coordinated playbook:", error);
    res.json({
      playbook_title: `Standard Operating Procedure Playbook: ${incident_type}`,
      severity: "ELEVATED",
      fifa_stewards_directives: [
        "Deploy stewards to zone entrance corridors.",
        "Facilitate orderly crowd dispersion."
      ],
      security_command_directives: [
        "Monitor crowd bottleneck points.",
        "Establish crowd barricades if necessary."
      ],
      medical_dispatch_directives: [
        "Prepare first-aid stations nearby.",
        "Secure emergency responder access routes."
      ],
      transit_authority_directives: [
        "Prepare shuttle buses to handle potential delays."
      ],
      predicted_resolution_time_minutes: 20
    });
  }
});

export default router;
