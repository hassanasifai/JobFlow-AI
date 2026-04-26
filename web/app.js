const state = {
  overview: null,
  search: '',
};

const statusOptions = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP'];
const commandLabels = {
  verify: 'Run health check',
  doctor: 'Run setup check',
  scan: 'Scan portals',
};

const elements = {
  refreshButton: document.querySelector('#refreshButton'),
  systemStatus: document.querySelector('#systemStatus'),
  metricApplications: document.querySelector('#metricApplications'),
  metricPipeline: document.querySelector('#metricPipeline'),
  metricScore: document.querySelector('#metricScore'),
  metricPdfs: document.querySelector('#metricPdfs'),
  setupList: document.querySelector('#setupList'),
  applicationsTable: document.querySelector('#applicationsTable'),
  pipelineList: document.querySelector('#pipelineList'),
  applicationSearch: document.querySelector('#applicationSearch'),
  inspectorTitle: document.querySelector('#inspectorTitle'),
  commandOutput: document.querySelector('#commandOutput'),
};

elements.refreshButton.addEventListener('click', loadOverview);
elements.applicationSearch.addEventListener('input', (event) => {
  state.search = event.target.value.toLowerCase();
  renderApplications();
});

document.querySelectorAll('[data-command]').forEach((button) => {
  button.addEventListener('click', () => runCommand(button.dataset.command, button));
});

document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach((item) => item.classList.remove('active'));
    link.classList.add('active');
  });
});

async function loadOverview() {
  setStatus('Refreshing local workspace...');
  try {
    const response = await fetch('/api/overview');
    state.overview = await response.json();
    renderOverview();
    setStatus(state.overview.setup.ready
      ? 'Workspace is ready. Your local files are connected.'
      : 'Setup needs attention. Follow the checklist below.');
  } catch (error) {
    setStatus(`Could not load workspace: ${error.message}`);
  }
}

function renderOverview() {
  const { metrics } = state.overview;
  elements.metricApplications.textContent = metrics.totalApplications;
  elements.metricPipeline.textContent = metrics.pendingPipeline;
  elements.metricScore.textContent = metrics.avgScore.toFixed(1);
  elements.metricPdfs.textContent = metrics.withPdf;
  renderSetup();
  renderApplications();
  renderPipeline();
}

function renderSetup() {
  elements.setupList.innerHTML = '';
  for (const check of state.overview.setup.checks) {
    const item = document.createElement('article');
    item.className = 'setup-item';
    item.innerHTML = `
      <span class="setup-state ${check.present ? 'ready' : ''}" aria-hidden="true">${check.present ? '✓' : '!'}</span>
      <span>
        <strong>${escapeHtml(check.path)}</strong>
        <p>${check.present ? 'Found and ready.' : escapeHtml(check.fix)}</p>
      </span>
    `;
    elements.setupList.append(item);
  }
}

function renderApplications() {
  elements.applicationsTable.innerHTML = '';
  const rows = state.overview.applications.filter((app) => {
    const haystack = `${app.company} ${app.role} ${app.status} ${app.notes}`.toLowerCase();
    return haystack.includes(state.search);
  });

  if (rows.length === 0) {
    elements.applicationsTable.innerHTML = '<div class="empty-state">No applications match this view yet.</div>';
    return;
  }

  for (const app of rows) {
    const row = document.createElement('article');
    row.className = 'application-row';
    row.innerHTML = `
      <div class="application-main">
        <strong>${escapeHtml(app.company)}</strong>
        <div class="application-meta">${escapeHtml(app.role)} · ${escapeHtml(app.date || 'No date')}</div>
      </div>
      <div class="score">${escapeHtml(app.scoreRaw || 'N/A')}</div>
      <label>
        <span class="sr-only">Status for ${escapeHtml(app.company)} ${escapeHtml(app.role)}</span>
        <select class="status-select" aria-label="Status for ${escapeHtml(app.company)} ${escapeHtml(app.role)}">
          ${statusOptions.map((status) => `<option value="${status}" ${status.toLowerCase() === app.status.toLowerCase() ? 'selected' : ''}>${status}</option>`).join('')}
        </select>
      </label>
      <button class="report-button" ${app.reportPath ? '' : 'disabled'} aria-label="Open report for ${escapeHtml(app.company)}">Open report</button>
    `;

    row.querySelector('select').addEventListener('change', (event) => updateStatus(app.number, event.target.value));
    row.querySelector('.report-button').addEventListener('click', () => openReport(app));
    elements.applicationsTable.append(row);
  }
}

function renderPipeline() {
  elements.pipelineList.innerHTML = '';
  if (state.overview.pipeline.length === 0) {
    elements.pipelineList.innerHTML = '<div class="empty-state">No pending job URLs. Run a scan or add URLs to data/pipeline.md.</div>';
    return;
  }

  for (const item of state.overview.pipeline.slice(0, 30)) {
    const card = document.createElement('article');
    card.className = 'pipeline-card';
    card.innerHTML = `
      <span>
        <strong>${escapeHtml(item.company)}</strong>
        <small>${escapeHtml(item.role)}</small>
      </span>
      <a href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">Open</a>
    `;
    elements.pipelineList.append(card);
  }
}

async function updateStatus(number, status) {
  setStatus(`Updating application #${number} to ${status}...`);
  const response = await fetch('/api/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ number, status }),
  });
  const result = await response.json();
  if (!response.ok) {
    setStatus(result.error || 'Status update failed.');
    return;
  }
  state.overview = result.overview;
  renderOverview();
  setStatus(`Application #${number} is now ${status}.`);
}

async function openReport(app) {
  elements.inspectorTitle.textContent = `${app.company} report`;
  elements.commandOutput.textContent = 'Loading report...';
  const response = await fetch(`/api/report?path=${encodeURIComponent(app.reportPath)}`);
  const result = await response.json();
  elements.commandOutput.textContent = result.content || result.error || 'No report content available.';
}

async function runCommand(command, button) {
  const label = button.querySelector('strong')?.textContent || commandLabels[command] || command;
  elements.inspectorTitle.textContent = label;
  elements.commandOutput.textContent = `${label} is running...`;
  button.disabled = true;
  setStatus(`${label} is running locally.`);

  try {
    const response = await fetch('/api/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const result = await response.json();
    elements.commandOutput.textContent = [result.stdout, result.stderr].filter(Boolean).join('\n') || 'Command finished with no output.';
    setStatus(result.ok ? `${label} finished successfully.` : `${label} needs attention.`);
    await loadOverview();
  } catch (error) {
    elements.commandOutput.textContent = error.message;
    setStatus(`${label} failed to run.`);
  } finally {
    button.disabled = false;
  }
}

function setStatus(message) {
  elements.systemStatus.textContent = message;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

loadOverview();
