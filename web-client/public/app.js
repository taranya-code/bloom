// Bloom Web Interface Client Logic
//
// Everything in this file talks to the real bloom-core Mastra server
// (POST /api/agents/:agentId/generate, POST /api/tools/:toolId/execute).
// There is no client-side fake/canned "smart response generator" here on
// purpose: this UI used to have one, and it made every tab look like it
// worked even with no backend running. If something below fails, you'll
// see an honest error telling you what to fix (start bloom-core, set
// GOOGLE_GENERATIVE_AI_API_KEY, etc.) instead of a scripted fake answer.
document.addEventListener('DOMContentLoaded', () => {
  // Point this at the API Gateway in production (see ../../api-gateway/),
  // not at bloom-core directly. Override at runtime with
  // window.BLOOM_API_BASE (set in index.html) without rebuilding anything,
  // since this is a plain static file, not a bundled app.
  const API_BASE = window.BLOOM_API_BASE || 'http://localhost:4111';

  // State
  let activeLanguage = 'en';

  const LANG_NAMES = {
    en: 'English',
    kn: 'Kannada (ಕನ್ನಡ)',
    ta: 'Tamil (தமிழ்)',
    hi: 'Hindi (हिंदी)',
  };

  const SAMPLE_SUMMARY_TEXT = `Patient Name: Rahul Sharma, Age: 34
Diagnosis: Acute Appendicitis (Laparoscopic Appendectomy done 04/08/2026)
Medications:
1. Tab Paracetamol 650mg - 1 tablet 3 times daily after food for 5 days (white round pill)
2. Tab Amoxiclav 625mg - 1 capsule twice daily after food for 7 days (yellow capsule)
3. Tab Pantoprazole 40mg - 1 tablet morning before food for 7 days (small yellow pill)
Warning Signs: High fever (>101F), severe abdominal pain, persistent vomiting, wound discharge.
Expected Symptoms: Mild pain at incision site, mild fatigue.
Follow-up: Visit OPD in 7 days (12-Aug-2026) for suture check.`;

  // DOM Elements
  const navButtons = document.querySelectorAll('.nav-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const chatMessages = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const userInput = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const traceBar = document.getElementById('trace-bar');
  const traceText = document.getElementById('trace-text');
  const clearChatBtn = document.getElementById('clear-chat-btn');
  const langSelect = document.getElementById('lang-select');
  const loadSampleBtn = document.getElementById('load-sample-btn');
  const backendStatusText = document.getElementById('backend-status-text');
  const backendStatusDot = document.querySelector('.status-dot');

  const summaryTextInput = document.getElementById('summary-text-input');
  const parseSummaryBtn = document.getElementById('parse-summary-btn');
  const fillSampleBtn = document.getElementById('fill-sample-btn');
  const parsedContent = document.getElementById('parsed-content');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('summary-file-input');
  const filePreview = document.getElementById('file-preview');

  const morningMedsContainer = document.getElementById('morning-meds');
  const afternoonMedsContainer = document.getElementById('afternoon-meds');
  const nightMedsContainer = document.getElementById('night-meds');

  const symptomInput = document.getElementById('symptom-input');
  const checkSymptomBtn = document.getElementById('check-symptom-btn');
  const triageOutputCard = document.getElementById('triage-output-card');

  const followupListContainer = document.getElementById('followup-list');

  // --- Tab Navigation ---
  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });

  function switchTab(targetTab) {
    navButtons.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === targetTab));
    tabContents.forEach((c) => c.classList.toggle('active', c.id === targetTab));
  }

  // --- Language selection actually affects replies now (it didn't before:
  // this dropdown used to only feed a fake local response generator).
  // Real agent calls get an explicit directive appended so the reply
  // language matches the dropdown even if the caregiver types in English.
  langSelect.addEventListener('change', (e) => {
    activeLanguage = e.target.value;
    appendSystemMessage(`Reply language set to ${LANG_NAMES[activeLanguage]}. This is now sent with every message to Bloom.`);
  });

  function withLanguageDirective(text) {
    if (activeLanguage === 'en') return text;
    return `${text}\n\n[Reply in ${LANG_NAMES[activeLanguage]}, regardless of what language this message is written in.]`;
  }

  // --- Backend connectivity ---
  async function checkBackendStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/agents`, { method: 'GET' });
      setBackendStatus(res.ok);
    } catch {
      setBackendStatus(false);
    }
  }

  function setBackendStatus(online) {
    if (backendStatusDot) backendStatusDot.classList.toggle('online', online);
    if (backendStatusDot) backendStatusDot.classList.toggle('offline', !online);
    if (backendStatusText) {
      backendStatusText.textContent = online
        ? `Mastra Backend: Connected (${API_BASE.replace(/^https?:\/\//, '')})`
        : `Mastra Backend: Unreachable — start "npm run dev" in bloom-core`;
    }
  }

  // --- Generic backend calls ---
  async function callAgent(agentId, userText) {
    return callAgentRaw(agentId, [{ type: 'text', text: withLanguageDirective(userText) }]);
  }

  // Multimodal variant: parserAgent's prompt already says "photo or text" (Gemini is
  // natively multimodal), but nothing in this client ever actually sent an image before
  // now -- the drop zone was decorative. `filePart` is one AI-SDK content part: either
  // { type: 'image', image: dataUrl } for photos, or { type: 'file', data: dataUrl,
  // mediaType: mimeType } for PDFs.
  async function callAgentRaw(agentId, contentParts) {
    const res = await fetch(`${API_BASE}/api/agents/${agentId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: contentParts }] }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `${agentId} responded with HTTP ${res.status}`);
    }
    const text =
      body.text ??
      (Array.isArray(body.messages) && body.messages.length
        ? body.messages[body.messages.length - 1].content
        : null);
    if (typeof text !== 'string') {
      throw new Error(`${agentId} returned an unexpected response shape (no .text field).`);
    }
    return { text, raw: body };
  }

  async function callTool(toolId, data) {
    const res = await fetch(`${API_BASE}/api/tools/${toolId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      throw new Error(body.error || `${toolId} responded with HTTP ${res.status}`);
    }
    return body;
  }

  function extractJson(text) {
    // parserAgent is instructed to output raw JSON, but strip markdown
    // fences defensively in case the model wraps it anyway.
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }

  // --- Quick Action Chips ---
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      userInput.value = chip.getAttribute('data-prompt');
      handleSendMessage();
    });
  });

  // --- Chat Submit ---
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSendMessage();
  });

  clearChatBtn.addEventListener('click', () => {
    chatMessages.innerHTML = `
      <div class="message assistant-msg">
        <div class="msg-avatar">🌸</div>
        <div class="msg-body">
          <div class="msg-content">
            <p>Namaste! I am <strong>Bloom</strong>, an AI assistant — not a doctor. I only reflect your discharge paper's own instructions.</p>
            <p>How can I help you or your family today?</p>
          </div>
          <div class="msg-meta">
            <span class="agent-tag">bloom coordinator</span>
            <span class="time">Just now</span>
          </div>
        </div>
      </div>`;
  });

  async function handleSendMessage() {
    const text = userInput.value.trim();
    if (!text) return;

    appendUserMessage(text);
    userInput.value = '';
    sendBtn.disabled = true;
    showTrace('🔍 Routing to bloom coordinator → grounding with Qdrant retrieval...');

    try {
      const { text: reply } = await callAgent('bloom', text);
      hideTrace();
      appendBotMessage(reply, 'bloom coordinator');
      setBackendStatus(true);
    } catch (err) {
      hideTrace();
      appendSystemMessage(
        `⚠️ Couldn't get a reply from Bloom: ${escapeHtml(err.message)}. ` +
          `Check that bloom-core is running (npm run dev) with GOOGLE_GENERATIVE_AI_API_KEY set.`,
      );
      setBackendStatus(false);
    } finally {
      sendBtn.disabled = false;
    }
  }

  function appendUserMessage(text) {
    const msgHtml = `
      <div class="message user-msg">
        <div class="msg-avatar"><i class="fa-solid fa-user"></i></div>
        <div class="msg-body">
          <div class="msg-content"><p>${escapeHtml(text)}</p></div>
          <div class="msg-meta"><span class="time">${nowTime()}</span></div>
        </div>
      </div>`;
    chatMessages.insertAdjacentHTML('beforeend', msgHtml);
    scrollChatToBottom();
  }

  function appendBotMessage(text, agentTag = 'bloom coordinator') {
    const msgHtml = `
      <div class="message assistant-msg">
        <div class="msg-avatar">🌸</div>
        <div class="msg-body">
          <div class="msg-content">${formatMarkdown(text)}</div>
          <div class="msg-meta">
            <span class="agent-tag">${escapeHtml(agentTag)}</span>
            <span class="time">${nowTime()}</span>
          </div>
        </div>
      </div>`;
    chatMessages.insertAdjacentHTML('beforeend', msgHtml);
    scrollChatToBottom();
  }

  function appendSystemMessage(text) {
    const msgHtml = `
      <div class="message assistant-msg">
        <div class="msg-avatar"><i class="fa-solid fa-circle-info"></i></div>
        <div class="msg-body">
          <div class="msg-content"><p>${text}</p></div>
          <div class="msg-meta"><span class="agent-tag">system</span><span class="time">${nowTime()}</span></div>
        </div>
      </div>`;
    chatMessages.insertAdjacentHTML('beforeend', msgHtml);
    scrollChatToBottom();
  }

  function scrollChatToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  function nowTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function showTrace(msg) {
    traceText.textContent = msg;
    traceBar.style.display = 'block';
  }
  function hideTrace() {
    traceBar.style.display = 'none';
  }

  // --- Discharge Parsing (real parserAgent call) ---
  loadSampleBtn.addEventListener('click', () => {
    switchTab('summary-tab');
    summaryTextInput.value = SAMPLE_SUMMARY_TEXT;
    parseSummaryBtn.click();
  });
  fillSampleBtn.addEventListener('click', () => {
    summaryTextInput.value = SAMPLE_SUMMARY_TEXT;
  });

  parseSummaryBtn.addEventListener('click', async () => {
    const text = summaryTextInput.value.trim();
    if (!text) {
      parsedContent.innerHTML = `<div class="empty-state"><i class="fa-solid fa-file-circle-question"></i><p>Paste a discharge summary or click "Load Sample Text" first.</p></div>`;
      return;
    }
    await runParse([{ type: 'text', text: withLanguageDirective(text) }], 'text');
  });

  // --- Photo/PDF upload: click-to-browse and drag-and-drop, both real (no
  // client-side OCR or fake extraction -- the image/PDF bytes go straight to
  // parserAgent, which is Gemini and natively multimodal). ---
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drop-zone-active');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drop-zone-active'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drop-zone-active');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFileSelected(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) handleFileSelected(fileInput.files[0]);
  });

  const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB -- generous for a phone photo of a discharge paper

  function handleFileSelected(file) {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      filePreview.style.display = 'block';
      filePreview.innerHTML = `<p style="color: var(--accent-red)">Unsupported file type (${escapeHtml(file.type || 'unknown')}). Use PNG, JPEG, WEBP, HEIC, or PDF.</p>`;
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      filePreview.style.display = 'block';
      filePreview.innerHTML = `<p style="color: var(--accent-red)">File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Keep it under 8MB.</p>`;
      return;
    }

    filePreview.style.display = 'block';
    filePreview.innerHTML = `<p><i class="fa-solid fa-file-circle-check"></i> ${escapeHtml(file.name)} (${(file.size / 1024).toFixed(0)}KB) -- reading...</p>`;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result; // e.g. "data:image/jpeg;base64,...."
      filePreview.innerHTML = `<p><i class="fa-solid fa-file-circle-check"></i> ${escapeHtml(file.name)} ready. Parsing...</p>`;
      const part =
        file.type === 'application/pdf'
          ? { type: 'file', data: dataUrl, mediaType: file.type }
          : { type: 'image', image: dataUrl };
      // A short text instruction still goes alongside the file part -- Gemini's
      // multimodal input is (text + media) together, not media alone.
      await runParse(
        [{ type: 'text', text: withLanguageDirective('Extract this discharge summary.') }, part],
        'file',
      );
      filePreview.innerHTML = `<p><i class="fa-solid fa-file-circle-check"></i> ${escapeHtml(file.name)} parsed.</p>`;
    };
    reader.onerror = () => {
      filePreview.innerHTML = `<p style="color: var(--accent-red)">Couldn't read the file: ${escapeHtml(reader.error?.message || 'unknown error')}.</p>`;
    };
    reader.readAsDataURL(file);
  }

  // Shared by both the text-paste and photo/PDF-upload paths: send to
  // parserAgent, parse the JSON reply, render it, and push the result into
  // the medication/follow-up stores so the other tabs go live too.
  async function runParse(contentParts, sourceLabel) {
    parsedContent.innerHTML = `<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Parsing with parserAgent${sourceLabel === 'file' ? ' (multimodal — reading the image/PDF directly)' : ''}...</p></div>`;
    parseSummaryBtn.disabled = true;

    try {
      const { text: reply } = await callAgentRaw('parserAgent', contentParts);
      const data = extractJson(reply);
      if (!data) {
        parsedContent.innerHTML = `
          <div class="empty-state">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <p>parserAgent replied, but it wasn't valid JSON. Raw output:</p>
          </div>
          <pre class="parsed-card" style="white-space: pre-wrap;">${escapeHtml(reply)}</pre>`;
        return;
      }
      renderParsedData(data);

      // Push the real parse into the backend's medication/follow-up stores
      // so the Medications and Follow-ups tabs (which read from
      // get_due_medications / list_followups) reflect what was just parsed,
      // instead of staying on whatever hardcoded demo data used to be there.
      if (Array.isArray(data.medications) && data.medications.length) {
        await callTool('set_schedule', { medications: data.medications });
      }
      if (Array.isArray(data.followups)) {
        for (const f of data.followups) {
          await callTool('add_followup', {
            raw_text: f.raw_text || '',
            purpose: f.purpose || '',
            date_iso: f.date || '',
          });
        }
      }
      await Promise.all([refreshMedications(), refreshFollowups()]);
      appendSystemMessage(`✅ Discharge summary parsed (${sourceLabel === 'file' ? 'from uploaded file' : 'from pasted text'}) and grounded. Medications and follow-ups tabs are now live.`);
    } catch (err) {
      parsedContent.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Parse failed: ${escapeHtml(err.message)}</p></div>`;
    } finally {
      parseSummaryBtn.disabled = false;
    }
  }

  function renderParsedData(data) {
    const meds = data.medications || [];
    const warnings = data.warning_signs || [];
    const expected = data.expected_symptoms || [];
    parsedContent.innerHTML = `
      <div class="parsed-box">
        <div class="parsed-card">
          <h4><i class="fa-solid fa-hospital-user"></i> Patient & Diagnosis</h4>
          <p><strong>Patient:</strong> ${escapeHtml(data.patient_name || 'Not stated')} ${data.age ? `(${escapeHtml(data.age)} yrs)` : ''}</p>
          <p><strong>Plain Summary:</strong> ${escapeHtml(data.diagnosis_plain || 'Not stated')}</p>
        </div>

        <div class="parsed-card">
          <h4><i class="fa-solid fa-pills"></i> Prescribed Medicines (${meds.length})</h4>
          <ul>
            ${meds.map((m) => `<li><strong>${escapeHtml(m.name)}</strong> — ${escapeHtml(m.purpose_plain || '')} (${escapeHtml(m.timing || '')}) ${m.appearance_hint ? `[<em>${escapeHtml(m.appearance_hint)}</em>]` : ''}</li>`).join('') || '<li>None extracted</li>'}
          </ul>
        </div>

        <div class="parsed-card">
          <h4><i class="fa-solid fa-triangle-exclamation"></i> Warning Signs (Call Doctor Immediately)</h4>
          <ul style="color: var(--accent-red)">
            ${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('') || '<li>None extracted</li>'}
          </ul>
        </div>

        <div class="parsed-card">
          <h4><i class="fa-solid fa-circle-info"></i> Normal Expected Symptoms</h4>
          <ul style="color: var(--accent-green)">
            ${expected.map((e) => `<li>${escapeHtml(e)}</li>`).join('') || '<li>None extracted</li>'}
          </ul>
        </div>

        ${data.confidence_notes && data.confidence_notes.length ? `
        <div class="parsed-card">
          <h4><i class="fa-solid fa-magnifying-glass"></i> Parser Confidence Notes</h4>
          <ul>${data.confidence_notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
        </div>` : ''}
      </div>`;
  }

  // --- Medications tab (real get_due_medications / mark_medication_taken) ---
  async function refreshMedications() {
    await Promise.all([
      renderMedSlot(morningMedsContainer, 'morning'),
      renderMedSlot(afternoonMedsContainer, 'afternoon'),
      renderMedSlot(nightMedsContainer, 'night'),
    ]);
  }

  async function renderMedSlot(container, timeOfDay) {
    container.innerHTML = `<p class="empty-state-inline">Loading...</p>`;
    try {
      const { medications } = await callTool('get_due_medications', { time_of_day: timeOfDay });
      if (!medications || !medications.length) {
        container.innerHTML = `<p class="empty-state-inline">No medicines scheduled. Parse a discharge summary first.</p>`;
        return;
      }
      container.innerHTML = medications.map((m) => medCardHtml(m)).join('');
      container.querySelectorAll('[data-mark-taken]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await callTool('mark_medication_taken', { name: btn.getAttribute('data-mark-taken') });
            await refreshMedications();
          } catch (err) {
            alert(`Couldn't mark as taken: ${err.message}`);
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      container.innerHTML = `<p class="empty-state-inline">Couldn't load: ${escapeHtml(err.message)}</p>`;
    }
  }

  function medCardHtml(m) {
    const foodBadge = m.with_food === true ? 'After Food' : m.with_food === false ? 'Before Food' : 'Timing as noted';
    return `
      <div class="med-item-card">
        <div>
          <span class="badge ${m.with_food ? 'badge-warn' : 'badge-success'}">${escapeHtml(foodBadge)}</span>
          <div class="med-name">${escapeHtml(m.name)}</div>
          <div class="med-dose">${escapeHtml(m.dose || '')}${m.appearance_hint ? ` — ${escapeHtml(m.appearance_hint)}` : ''}</div>
          <div class="med-hint">${escapeHtml(m.purpose_plain || '')}</div>
        </div>
        <button class="btn btn-secondary btn-sm" ${m.taken_today ? 'disabled' : ''} data-mark-taken="${escapeHtml(m.name)}">
          <i class="fa-solid fa-check"></i> ${m.taken_today ? 'Taken today' : 'Mark Taken'}
        </button>
      </div>`;
  }

  // --- Follow-ups tab (real list_followups) ---
  async function refreshFollowups() {
    followupListContainer.innerHTML = `<p class="empty-state-inline">Loading...</p>`;
    try {
      const { followups } = await callTool('list_followups', {});
      if (!followups || !followups.length) {
        followupListContainer.innerHTML = `<p class="empty-state-inline">No follow-ups yet. Parse a discharge summary first.</p>`;
        return;
      }
      followupListContainer.innerHTML = followups
        .map(
          (f) => `
        <div class="followup-card" style="${f.is_overdue ? 'border-color: var(--accent-red);' : ''}">
          <div>
            <div class="followup-date"><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(f.date || 'Date not stated')}${f.is_overdue ? ' — OVERDUE' : ''}</div>
            <p><strong>Purpose:</strong> ${escapeHtml(f.purpose)}</p>
            <p style="font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(f.raw_text || '')}</p>
          </div>
          <button class="btn btn-secondary btn-sm" data-done="${escapeHtml(f.purpose)}" ${f.done ? 'disabled' : ''}>
            ${f.done ? 'Done' : 'Mark Done'}
          </button>
        </div>`,
        )
        .join('');
      followupListContainer.querySelectorAll('[data-done]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await callTool('mark_followup_done', { purpose: btn.getAttribute('data-done') });
            await refreshFollowups();
          } catch (err) {
            alert(`Couldn't mark done: ${err.message}`);
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      followupListContainer.innerHTML = `<p class="empty-state-inline">Couldn't load: ${escapeHtml(err.message)}</p>`;
    }
  }

  // --- Symptom Triage tab (real redflagAgent call, no client-side fake detector) ---
  checkSymptomBtn.addEventListener('click', async () => {
    const text = symptomInput.value.trim();
    if (!text) return;

    triageOutputCard.innerHTML = `<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>redflagAgent is checking this against your discharge note (Qdrant retrieval + Enkrypt safety gate)...</p></div>`;
    checkSymptomBtn.disabled = true;

    try {
      const { text: reply } = await callAgent('redflagAgent', text);
      triageOutputCard.innerHTML = `
        <div class="parsed-card">
          <span class="badge badge-shield"><i class="fa-solid fa-shield-heart"></i> Grounded in your discharge note, checked by Enkrypt</span>
          <div style="margin-top: 0.75rem;">${formatMarkdown(reply)}</div>
        </div>
        <p style="margin-top: 1rem; text-align: center;">
          <a class="btn btn-primary btn-sm" href="tel:108"><i class="fa-solid fa-phone-flip"></i> Call Emergency (108)</a>
        </p>`;
    } catch (err) {
      triageOutputCard.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Couldn't reach redflagAgent: ${escapeHtml(err.message)}</p></div>`;
    } finally {
      checkSymptomBtn.disabled = false;
    }
  });

  // --- Init ---
  checkBackendStatus();
  setInterval(checkBackendStatus, 15000);
  refreshMedications();
  refreshFollowups();
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMarkdown(str) {
  return escapeHtml(str)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}
