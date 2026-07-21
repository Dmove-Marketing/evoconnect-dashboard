document.addEventListener('DOMContentLoaded', () => {
  const adminLoginCard = document.getElementById('admin-login-card');
  const adminDashboard = document.getElementById('admin-dashboard');
  const btnAdminLogin = document.getElementById('btn-admin-login');
  const adminPasswordInput = document.getElementById('admin-password');
  const btnLogoutAdmin = document.getElementById('btn-logout-admin');

  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

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

  // Checa autenticação inicial
  const savedToken = localStorage.getItem('evoconnect_admin_token');
  if (savedToken === 'admin-authenticated-session') {
    showDashboard();
  }

  // Login
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

  // Navegação por Abas
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

  // Carrega Visão Geral
  function loadOverviewData() {
    fetch('/api/admin/overview')
      .then(res => res.json())
      .then(data => {
        statTotalClients.textContent = data.totalClients;
        statConnected.textContent = data.connectedCount;
        statDisconnected.textContent = data.disconnectedCount;
        statTotalServers.textContent = data.totalServers;

        renderOverviewTable(data.clients);
        renderClientsTable(data.clients);
        renderServersTable(data.servers);
        populateServerDropdowns(data.servers);
        populateAlertsTab(data.masterInstance);
        populateSettingsTab(data.settings);
      })
      .catch(err => console.error('Erro ao carregar dados do admin:', err));
  }

  // Renderiza Tabela da Visão Geral com Botão de Copiar Link
  function renderOverviewTable(clients) {
    if (!clients || clients.length === 0) {
      overviewClientsTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Nenhum cliente cadastrado ainda.</td></tr>`;
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

  // Renderiza Tabela de Gerenciamento de Clientes
  function renderClientsTable(clients) {
    if (!clients || clients.length === 0) {
      clientsTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Nenhum cliente cadastrado.</td></tr>`;
      return;
    }

    clientsTbody.innerHTML = clients.map(c => `
      <tr>
        <td><b>${escapeHtml(c.name)}</b></td>
        <td>${c.phone ? escapeHtml(c.phone) : '<span style="color:var(--text-muted)">Sem número</span>'}</td>
        <td><code>${escapeHtml(c.instanceName)}</code></td>
        <td>
          <button class="btn btn-danger" onclick="deleteClient('${c.id}')" style="padding: 4px 10px; font-size: 0.8rem;">
            🗑️ Excluir
          </button>
        </td>
      </tr>
    `).join('');
  }

  // Renderiza Tabela de Servidores EVO
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

  // Sincroniza cor picker com campo texto
  settingPrimaryColorPicker.addEventListener('input', (e) => {
    settingPrimaryColor.value = e.target.value;
  });

  // Criar Servidor
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

  // Criar Cliente
  btnCreateClient.addEventListener('click', () => {
    const name = clientNameInput.value.trim();
    const phone = clientPhoneInput.value.trim();
    const serverId = clientServerSelect.value;
    const instanceName = clientInstanceInput.value.trim();

    if (!name || !serverId || !instanceName) {
      alert('Preencha o nome do cliente, selecione o servidor e informe a instância.');
      return;
    }

    fetch('/api/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, serverId, instanceName })
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          clientNameInput.value = '';
          clientPhoneInput.value = '';
          clientInstanceInput.value = '';
          loadOverviewData();
          alert('Cliente cadastrado com sucesso!');
        } else {
          alert(data.error || 'Erro ao cadastrar cliente');
        }
      });
  });

  // Salvar Instância Master de Alertas
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
        if (data.ok) {
          alert('Configurações de alerta master salvas com sucesso!');
        }
      });
  });

  // Testar Alerta Manual
  btnTestAlert.addEventListener('click', () => {
    const testPhone = testPhoneInput.value.trim();
    if (!testPhone) {
      alert('Informe um número de telefone com DDD para receber o teste.');
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
        if (data.ok) {
          alert(data.message);
        } else {
          alert(data.error || 'Erro ao enviar alerta de teste.');
        }
      })
      .catch(() => {
        btnTestAlert.disabled = false;
        btnTestAlert.textContent = 'Enviar Teste';
        alert('Erro ao comunicar com o servidor.');
      });
  });

  // Salvar Personalização White-Label
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
        if (data.ok) {
          alert('Configurações de marca salvas com sucesso!');
        }
      });
  });

  // Funções Globais (Excluir e Copiar)
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
