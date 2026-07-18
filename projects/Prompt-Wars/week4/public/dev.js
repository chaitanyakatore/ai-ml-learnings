// StadiumPulse AI — Dev Simulation Controller
async function setPreset(preset) {
  // Update UI active buttons
  document.querySelectorAll('.btn-preset').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`btn-preset-${preset}`);
  if (activeBtn) activeBtn.classList.add('active');

  const labels = {
    normal: 'Normal Flow',
    halftime: 'Halftime Concourse Rush',
    gate_closure: 'Gate 3 Security Closure',
    exit_surge: 'Post-Match Exit Surge'
  };
  
  const activePresetLabel = document.getElementById('lbl-active-preset');
  if (activePresetLabel) activePresetLabel.innerText = labels[preset];

  try {
    const response = await fetch('/api/simulate-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset })
    });
    const result = await response.json();
    console.log('Preset successfully activated:', preset, result);
  } catch (error) {
    console.error('Error setting simulation preset:', error);
  }
}
