document.addEventListener('DOMContentLoaded', () => {
  const adminLoginCard = document.getElementById('admin-login-card');
  const adminDashboard = document.getElementById('admin-dashboard');
  const btnAdminLogin = document.getElementById('btn-admin-login');
  const adminPasswordInput = document.getElementById('admin-password');
  const btnLogoutAdmin = document.getElementById('btn-logout-admin');

  const btnSyncAll = document.getElementById('btn-sync-all');
  const btnSyncOverview = document.getElementById('btn-sync-overview');

  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  // Dados armazenados em memória para filtros
  let rawClientsData = [];
  let rawServersData = [];

  // Elementos de Filtro
  const overviewSearchInput = document.getElementById('overview-search-input');
  const overviewServerFilter = document.getElementById('overview-server-filter');
  const overviewStatusFilter = document.getElementById('overview-status-filter');

  const clientsSearchInput = document.getElementById('clients-search-input');
  const clientsServerFilter = document.getElementById('clients-server-filter');

  // Elementos da Aba Overview
  const statTotalClients = document.getElementById('stat-total-clients');
  const statConnected = document.getElementById('stat-connected');
  const statDisconnected = document.getElementById('stat-disconnected');
  const statTotalServers = document.getElementById('stat-total-servers');
  const overviewClientsTbody = document.getElementById('overview-clients-tbody');

  // Elementos da Aba Clientes
  const btnCreateClient = document.getElementById('btn-create-client');
  const clientNameInput = document.getElementById('client-name');
  const clientPhoneInput = document.getElementById('client-phone');
  const clientServerSelect = document.getElementById('client-server-id');
  const clientInstanceInput = document.getElementById('client-instance-name');
  const clientCreateInEvoCheck = document.getElementById('client-create-in-evo');
  const clientsTbody = document.getElementById('clients-tbody');

  // Elementos da Aba Servidores
  const btnCreateServer = document.getElementById('btn-create-server');
  const serverNameInput = document.getElementById('server-name');
  const serverUrlInput = document.getElementById('server-url');
  const serverApiKeyInput = document.getElementById('server-apikey');
  const serverVersionSelect = document.getElementById('server-version');
  const serversTbody = document.getElementById('servers-tbody');

  // Elementos da Aba Alertas
  const masterServerSelect = document.getElementById('master-server-id');
  const masterInstanceInput = document.getElementById('master-instance-name');
  const masterIsEnabledCheck = document.getElementById('master-is-enabled');
  const masterTemplateTextarea = document.getElementById('master-template');
  const btnSaveMaster = document.getElementById('btn-save-master');
  const btnTestAlert = document.getElementById('btn-test-alert');
  const testPhoneInput = document.getElementById('test-phone-input');

  // Elementos da Aba Configurações (White-Label)
  const settingAgencyName = document.getElementById('setting-agency-name');
  const settingLogoUrl = document.getElementById('setting-logo-url');
  const settingPrimaryColor = document.getElementById('setting-primary-color');
  const settingPrimaryColorPicker = document.getElementById('setting-primary-color-picker');
  const settingAdminPassword = document.getElementById('setting-admin-password');
  const btnSaveSettings = document.getElementById('btn-save-settings');

  const savedToken = localStorage.getItem('evoconnect_admin_token');
  if (savedToken === 'admin-authenticated-session') {
    showDashboard();
  }

  btnAdminLogin.addEventListener('click', () => {
    const password = adminPasswordInput.value;
    fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          localStorage.setItem('evoconnect_admin_token', data.token);
          showDashboard();
        } else {
          alert('Senha incorreta!');
        }
      })
      .catch(() => alert('Erro de conexão ao tentar fazer login.'));
  });

  btnLogoutAdmin.addEventListener('click', () => {
    localStorage.removeItem('evoconnect_admin_token');
    window.location.reload();
  });

  function showDashboard() {
    adminLoginCard.style.display = 'none';
    adminDashboard.style.display = 'block';
    btnLogoutAdmin.style.display = 'inline-flex';
    loadOverviewData();
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.style.display = 'none');

      btn.classList.add('active');
      const targetTab = btn.getAttribute('data-tab');
      document.getElementById(targetTab).style.display = 'block';

      if (targetTab === 'tab-overview' || targetTab === 'tab-clients' || targetTab === 'tab-alerts') {
        loadOverviewData();
      }
    });
  });

  function triggerSync() {
    btnSyncAll.disabled = true;
    btnSyncAll.textContent = '🔄 Sincronizando...';

    fetch('/api/admin/sync-instances', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        btnSyncAll.disabled = false;
        btnSyncAll.textContent = '🔄 Sincronizar Instâncias da EVO';
        loadOverviewData();
        if (data.addedCount > 0) {
          alert(`Sincronização concluída! ${data.addedCount} nova(s) instância(s) encontrada(s) e adicionada(s) ao painel.`);
        } else {
          alert('Todas as instâncias já estão sincronizadas com o painel!');
        }
      })
      .catch(() => {
        btnSyncAll.disabled = false;
        btnSyncAll.textContent = '🔄 Sincronizar Instâncias da EVO';
      });
  }

  if (btnSyncAll) btnSyncAll.addEventListener('click', triggerSync);
  if (btnSyncOverview) btnSyncOverview.addEventListener('click', triggerSync);

  function loadOverviewData() {
    fetch('/api/admin/overview')
      .then(res => res.json())
      .then(data => {
        rawClientsData = data.clients || [];
        rawServersData = data.servers || [];

        statTotalClients.textContent = data.totalClients;
        statConnected.textContent = data.connectedCount;
        statDisconnected.textContent = data.disconnectedCount;
        statTotalServers.textContent = data.totalServers;

        populateServerDropdowns(data.servers);
        applyOverviewFilters();
        applyClientsFilters();
        renderServersTable(data.servers);
        populateAlertsTab(data.masterInstance);
        populateSettingsTab(data.settings);
      })
      .catch(err => console.error('Erro ao carregar dados do admin:', err));
  }

  // Lógica de Filtros da Visão Geral
  function applyOverviewFilters() {
    const searchTerm = (overviewSearchInput?.value || '').toLowerCase().trim();
    const selectedServer = overviewServerFilter?.value || '';
    const selectedStatus = overviewStatusFilter?.value || '';

    const filtered = rawClientsData.filter(c => {
      const nameMatch = (c.name || '').toLowerCase().includes(searchTerm) || (c.instanceName || '').toLowerCase().includes(searchTerm);
      const serverMatch = !selectedServer || c.serverId === selectedServer;
      const statusMatch = !selectedStatus || c.currentStatus === selectedStatus;
      return nameMatch && serverMatch && statusMatch;
    });

    renderOverviewTable(filtered);
  }

  // Lógica de Filtros da Aba Clientes
  function applyClientsFilters() {
    const searchTerm = (clientsSearchInput?.value || '').toLowerCase().trim();
    const selectedServer = clientsServerFilter?.value || '';

    const filtered = rawClientsData.filter(c => {
      const nameMatch = (c.name || '').toLowerCase().includes(searchTerm) || (c.instanceName || '').toLowerCase().includes(searchTerm);
      const serverMatch = !selectedServer || c.serverId === selectedServer;
      return nameMatch && serverMatch;
    });

    renderClientsTable(filtered);
  }

  // Event Listeners dos Filtros
  if (overviewSearchInput) overviewSearchInput.addEventListener('input', applyOverviewFilters);
  if (overviewServerFilter) overviewServerFilter.addEventListener('change', applyOverviewFilters);
  if (overviewStatusFilter) overviewStatusFilter.addEventListener('change', applyOverviewFilters);

  if (clientsSearchInput) clientsSearchInput.addEventListener('input', applyClientsFilters);
  if (clientsServerFilter) clientsServerFilter.addEventListener('change', applyClientsFilters);

  function renderOverviewTable(clients) {
    if (!clients || clients.length === 0) {
      const emptyMsg = rawClientsData.length > 0 
        ? 'Nenhum cliente encontrado com os filtros aplicados.' 
        : 'Nenhum cliente cadastrado ainda. Clique em "Sincronizar Instâncias" para buscar instâncias existentes na EVO.';
      overviewClientsTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">${emptyMsg}</td></tr>`;
      return;
    }

    const host = window.location.origin;

    overviewClientsTbody.innerHTML = clients.map(c => {
      const link = `${host}/?token=${c.token}`;
      const statusBadge = c.currentStatus === 'CONNECTED' 
        ? `<span class="status-badge connected" style="font-size: 0.75rem; padding: 4px 10px;"><span class="pulse-dot"></span>Conectado</span>`
        : `<span class="status-badge disconnected" style="font-size: 0.75rem; padding: 4px 10px;"><span class="pulse-dot"></span>Desconectado</span>`;

      return `
        <tr>
          <td><b>${escapeHtml(c.name)}</b></td>
          <td><code>${escapeHtml(c.instanceName)}</code></td>
          <td>${escapeHtml(c.serverName)}</td>
          <td>${statusBadge}</td>
          <td>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <input type="text" class="form-control" value="${link}" readonly style="font-size: 0.8rem; padding: 4px 8px; width: 220px;">
              <button class="btn btn-secondary" onclick="copyLink('${link}')" style="padding: 4px 10px; font-size: 0.8rem;">
                📋 Copiar
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderClientsTable(clients) {
    if (!clients || clients.length === 0) {
      const emptyMsg = rawClientsData.length > 0 
        ? 'Nenhum cliente encontrado com os filtros aplicados.' 
        : 'Nenhum cliente cadastrado.';
      clientsTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">${emptyMsg}</td></tr>`;
      return;
    }

    clientsTbody.innerHTML = clients.map(c => {
      const tag = c.autoDiscovered 
        ? `<span style="font-size: 0.7rem; background: rgba(59,130,246,0.2); color: #60a5fa; padding: 2px 6px; border-radius: 4px;">EVO Sync</span>`
        : `<span style="font-size: 0.7rem; background: rgba(16,185,129,0.2); color: #34d399; padding: 2px 6px; border-radius: 4px;">Manual</span>`;

      return `
        <tr>
          <td><b>${escapeHtml(c.name)}</b></td>
          <td>${c.phone ? escapeHtml(c.phone) : '<span style="color:var(--text-muted)">Sem número</span>'}</td>
          <td><code>${escapeHtml(c.instanceName)}</code></td>
          <td>${tag}</td>
          <td>
            <button class="btn btn-danger" onclick="deleteClient('${c.id}')" style="padding: 4px 10px; font-size: 0.8rem;">
              🗑️ Excluir
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderServersTable(servers) {
    if (!servers || servers.length === 0) {
      serversTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Nenhum servidor cadastrado.</td></tr>`;
      return;
    }

    serversTbody.innerHTML = servers.map(s => `
      <tr>
        <td><b>${escapeHtml(s.name)}</b></td>
        <td><code>${escapeHtml(s.url)}</code></td>
        <td><span style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 6px; font-size: 0.8rem;">${s.version.toUpperCase()}</span></td>
        <td>
          <button class="btn btn-danger" onclick="deleteServer('${s.id}')" style="padding: 4px 10px; font-size: 0.8rem;">
            🗑️ Excluir
          </button>
        </td>
      </tr>
    `).join('');
  }

  function populateServerDropdowns(servers) {
    const options = servers.map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${s.version.toUpperCase()})</option>`).join('');
    clientServerSelect.innerHTML = `<option value="">Selecione um servidor...</option>` + options;
    masterServerSelect.innerHTML = `<option value="">Selecione o servidor...</option>` + options;

    const currentOverviewVal = overviewServerFilter ? overviewServerFilter.value : '';
    const currentClientsVal = clientsServerFilter ? clientsServerFilter.value : '';

    if (overviewServerFilter) {
      overviewServerFilter.innerHTML = `<option value="">Todas as APIs / Servidores</option>` + options;
      if (currentOverviewVal) overviewServerFilter.value = currentOverviewVal;
    }
    if (clientsServerFilter) {
      clientsServerFilter.innerHTML = `<option value="">Todas as APIs / Servidores</option>` + options;
      if (currentClientsVal) clientsServerFilter.value = currentClientsVal;
    }
  }

  function populateAlertsTab(master) {
    if (!master) return;
    if (master.serverId) masterServerSelect.value = master.serverId;
    if (master.instanceName) masterInstanceInput.value = master.instanceName;
    masterIsEnabledCheck.checked = !!master.isEnabled;
    if (master.template) masterTemplateTextarea.value = master.template;
  }

  function populateSettingsTab(settings) {
    if (!settings) return;
    settingAgencyName.value = settings.agencyName || '';
    settingLogoUrl.value = settings.logoUrl || '';
    settingPrimaryColor.value = settings.primaryColor || '#059669';
    settingPrimaryColorPicker.value = settings.primaryColor || '#059669';
  }

  settingPrimaryColorPicker.addEventListener('input', (e) => {
    settingPrimaryColor.value = e.target.value;
  });

  btnCreateServer.addEventListener('click', () => {
    const name = serverNameInput.value.trim();
    const url = serverUrlInput.value.trim();
    const apiKey = serverApiKeyInput.value.trim();
    const version = serverVersionSelect.value;

    if (!name || !url || !apiKey) {
      alert('Preencha nome, URL e API Key do servidor.');
      return;
    }

    fetch('/api/admin/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url, apiKey, version })
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          serverNameInput.value = '';
          serverUrlInput.value = '';
          serverApiKeyInput.value = '';
          loadOverviewData();
          alert('Servidor EVO cadastrado com sucesso!');
        } else {
          alert(data.error || 'Erro ao cadastrar servidor');
        }
      });
  });

  btnCreateClient.addEventListener('click', () => {
    const name = clientNameInput.value.trim();
    const phone = clientPhoneInput.value.trim();
    const serverId = clientServerSelect.value;
    const instanceName = clientInstanceInput.value.trim();
    const createInEVO = clientCreateInEvoCheck.checked;

    if (!name || !serverId || !instanceName) {
      alert('Preencha o nome do cliente, selecione o servidor e informe a instância.');
      return;
    }

    btnCreateClient.disabled = true;
    btnCreateClient.textContent = 'Criando...';

    fetch('/api/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, serverId, instanceName, createInEVO })
    })
      .then(res => res.json())
      .then(data => {
        btnCreateClient.disabled = false;
        btnCreateClient.textContent = '➕ Cadastrar Cliente';

        if (data.ok) {
          clientNameInput.value = '';
          clientPhoneInput.value = '';
          clientInstanceInput.value = '';
          clientCreateInEvoCheck.checked = false;
          loadOverviewData();
          alert('Cliente cadastrado com sucesso!');
        } else {
          alert(data.error || 'Erro ao cadastrar cliente');
        }
      })
      .catch(() => {
        btnCreateClient.disabled = false;
        btnCreateClient.textContent = '➕ Cadastrar Cliente';
      });
  });

  btnSaveMaster.addEventListener('click', () => {
    const serverId = masterServerSelect.value;
    const instanceName = masterInstanceInput.value.trim();
    const isEnabled = masterIsEnabledCheck.checked;
    const template = masterTemplateTextarea.value;

    fetch('/api/admin/master-instance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, instanceName, isEnabled, template })
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok) alert('Configurações de alerta master salvas!');
      });
  });

  btnTestAlert.addEventListener('click', () => {
    const testPhone = testPhoneInput.value.trim();
    if (!testPhone) {
      alert('Informe um número de telefone com DDD.');
      return;
    }

    btnTestAlert.disabled = true;
    btnTestAlert.textContent = 'Enviando...';

    fetch('/api/admin/master-instance/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testPhone })
    })
      .then(res => res.json())
      .then(data => {
        btnTestAlert.disabled = false;
        btnTestAlert.textContent = 'Enviar Teste';
        if (data.ok) alert(data.message);
        else alert(data.error || 'Erro ao enviar alerta.');
      })
      .catch(() => {
        btnTestAlert.disabled = false;
        btnTestAlert.textContent = 'Enviar Teste';
      });
  });

  btnSaveSettings.addEventListener('click', () => {
    const agencyName = settingAgencyName.value.trim();
    const logoUrl = settingLogoUrl.value.trim();
    const primaryColor = settingPrimaryColor.value.trim();
    const adminPassword = settingAdminPassword.value.trim();

    fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agencyName, logoUrl, primaryColor, adminPassword })
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok) alert('Configurações de marca salvas com sucesso!');
      });
  });

  window.copyLink = function(link) {
    navigator.clipboard.writeText(link).then(() => {
      alert('Link copiado para a área de transferência!');
    });
  };

  window.deleteClient = function(id) {
    if (!confirm('Tem certeza que deseja excluir este cliente?')) return;
    fetch(`/api/admin/clients/${id}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(() => loadOverviewData());
  };

  window.deleteServer = function(id) {
    if (!confirm('Tem certeza que deseja excluir este servidor EVO?')) return;
    fetch(`/api/admin/servers/${id}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(() => loadOverviewData());
  };

  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, function(m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  }
});
