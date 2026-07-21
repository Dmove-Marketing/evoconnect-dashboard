process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Path do Banco de Dados JSON
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      servers: [],
      clients: [],
      masterInstance: {
        serverId: '',
        instanceName: '',
        isEnabled: false,
        template: 'Olá {{nome_cliente}}! ⚠️\nIdentificamos que a sua conexão do WhatsApp ({{nome_instancia}}) foi desconectada.\n\nAcesse o link abaixo para reconectar seu WhatsApp agora:\n👉 {{link_painel}}'
      },
      settings: {
        agencyName: 'EvoConnect',
        logoUrl: '',
        primaryColor: '#059669',
        adminPassword: 'admin',
        apiKey: 'evoconnect_secret_api_key_2026'
      }
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return { servers: [], clients: [], masterInstance: {}, settings: {} };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ----------------------------------------------------
// ADAPTADOR UNIVERSAL EVOLUTION API (v1, v2 & Evolution Go)
// ----------------------------------------------------

async function evoFetch(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    clearTimeout(timeoutId);
    return { ok: false, status: 500, error: error.message };
  }
}

// Helper para buscar instâncias remotas (Suporte a Evolution API Node & Evolution Go)
async function fetchServerInstances(server) {
  if (!server || !server.url || !server.apiKey) return [];
  const cleanUrl = server.url.replace(/\/$/, '');

  // 1. Tenta endpoint do Evolution Go (/instance/all ou /instance/fetch)
  let res = await evoFetch(`${cleanUrl}/instance/all`, {
    headers: { 'apikey': server.apiKey }
  });

  if (res.ok && (Array.isArray(res.data) || Array.isArray(res.data?.response))) {
    const list = Array.isArray(res.data) ? res.data : res.data.response;
    return list
      .filter(item => typeof item === 'object' && item.name)
      .map(item => ({
        name: item.name || item.instanceName || 'Instância',
        status: item.connected ? 'open' : 'close',
        token: item.token || ''
      }));
  }

  res = await evoFetch(`${cleanUrl}/instance/fetch`, {
    headers: { 'apikey': server.apiKey }
  });

  if (res.ok && (Array.isArray(res.data) || Array.isArray(res.data?.response))) {
    const list = Array.isArray(res.data) ? res.data : res.data.response;
    return list
      .filter(item => typeof item === 'object' && item.name)
      .map(item => ({
        name: item.name || item.instanceName || 'Instância',
        status: item.connected ? 'open' : 'close',
        token: item.token || ''
      }));
  }

  // 2. Tenta endpoint padrão v1/v2 Baileys (/instance/fetchInstances)
  res = await evoFetch(`${cleanUrl}/instance/fetchInstances`, {
    headers: { 'apikey': server.apiKey }
  });

  if (res.ok && Array.isArray(res.data)) {
    return res.data.map(item => ({
      name: item.instance?.instanceName || item.name || item.instanceName || 'Instância',
      status: item.instance?.status || item.instance?.state || item.status || (item.connected ? 'open' : 'close'),
      token: item.token || item.instance?.token || ''
    }));
  }

  return [];
}

// 1. Obter Status da Conexão (v1, v2 e Go)
async function getEVOStatus(server, instanceName, clientEvoToken = '') {
  if (!server || !server.url || !server.apiKey) {
    return { status: 'DISCONNECTED', raw: 'Servidor EVO não configurado' };
  }

  const cleanUrl = server.url.replace(/\/$/, '');

  // Suporte a Evolution Go: tenta buscar status via /instance/status com o token da instância
  const activeKey = clientEvoToken || server.apiKey;
  let res = await evoFetch(`${cleanUrl}/instance/status`, {
    headers: { 'apikey': activeKey }
  });

  if (res.ok && res.data?.data) {
    const isConnected = res.data.data.Connected || res.data.data.LoggedIn;
    return {
      status: isConnected ? 'CONNECTED' : 'DISCONNECTED',
      phone: res.data.data.Jid || '',
      profileName: res.data.data.Name || ''
    };
  }

  // Tenta endpoint padrão v1/v2 (/instance/connectionState/:name)
  res = await evoFetch(`${cleanUrl}/instance/connectionState/${instanceName}`, {
    headers: { 'apikey': server.apiKey }
  });

  if (res.ok) {
    const stateData = res.data?.instance?.state || res.data?.instance?.status || res.data?.state || res.data?.status;
    if (stateData === 'open' || stateData === 'connected') {
      return {
        status: 'CONNECTED',
        phone: res.data?.instance?.owner || res.data?.owner || '',
        profileName: res.data?.instance?.profileName || res.data?.profileName || ''
      };
    } else if (stateData === 'connecting') {
      return { status: 'CONNECTING' };
    } else {
      return { status: 'DISCONNECTED' };
    }
  }

  // Fallback para Evolution Go: busca a lista geral /instance/all
  const allInstances = await fetchServerInstances(server);
  const found = allInstances.find(i => i.name === instanceName);
  if (found) {
    return { status: found.status === 'open' ? 'CONNECTED' : 'DISCONNECTED' };
  }

  return { status: 'DISCONNECTED' };
}

// 2. Obter QR Code (v1, v2 e Go)
async function getEVOQRCode(server, instanceName, clientEvoToken = '') {
  if (!server || !server.url || !server.apiKey) {
    return { ok: false, message: 'Servidor EVO não configurado' };
  }

  const cleanUrl = server.url.replace(/\/$/, '');
  const activeKey = clientEvoToken || server.apiKey;

  // Evolution Go: tenta /instance/qr usando o token da instância ou apiKey
  let res = await evoFetch(`${cleanUrl}/instance/qr`, {
    headers: { 'apikey': activeKey }
  });

  if (res.ok) {
    let qrCode = res.data?.qrcode || res.data?.code || res.data?.base64 || res.data?.data?.qrcode;
    let pairingCode = res.data?.pairingCode || null;
    if (qrCode && !qrCode.startsWith('data:image')) {
      qrCode = `data:image/png;base64,${qrCode}`;
    }
    return { ok: true, qrCode, pairingCode };
  }

  // Tenta endpoint v1/v2 (/instance/connect/:name)
  res = await evoFetch(`${cleanUrl}/instance/connect/${instanceName}`, {
    headers: { 'apikey': server.apiKey }
  });

  if (res.ok) {
    let qrCode = res.data?.code || res.data?.base64 || res.data?.qrcode?.base64 || res.data?.qrcode;
    let pairingCode = res.data?.pairingCode || null;
    if (qrCode && !qrCode.startsWith('data:image')) {
      qrCode = `data:image/png;base64,${qrCode}`;
    }
    return { ok: true, qrCode, pairingCode };
  }

  return { ok: false, message: res.data?.message || res.data?.error || 'Falha ao buscar QR Code' };
}

// 3. Gerar Código de Pareamento
async function getEVOPairingCode(server, instanceName, phoneNumber, clientEvoToken = '') {
  if (!server || !server.url || !server.apiKey) {
    return { ok: false, message: 'Servidor EVO não configurado' };
  }

  const cleanUrl = server.url.replace(/\/$/, '');
  const activeKey = clientEvoToken || server.apiKey;
  const cleanPhone = phoneNumber.replace(/\D/g, '');

  // Evolution Go: POST /instance/pair
  let res = await evoFetch(`${cleanUrl}/instance/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': activeKey },
    body: JSON.stringify({ phone: cleanPhone })
  });

  if (res.ok) {
    const code = res.data?.pairingCode || res.data?.code || res.data?.data?.code;
    return { ok: true, pairingCode: code };
  }

  res = await evoFetch(`${cleanUrl}/instance/connect/${instanceName}?number=${cleanPhone}`, {
    headers: { 'apikey': server.apiKey }
  });

  if (res.ok) {
    const code = res.data?.pairingCode || res.data?.code;
    return { ok: true, pairingCode: code };
  }

  return { ok: false, message: 'Erro ao gerar código de pareamento' };
}

// 4. Logout / Desconectar
async function logoutEVOInstance(server, instanceName, clientEvoToken = '') {
  if (!server || !server.url || !server.apiKey) {
    return { ok: false, message: 'Servidor EVO não configurado' };
  }

  const cleanUrl = server.url.replace(/\/$/, '');
  const activeKey = clientEvoToken || server.apiKey;

  // Evolution Go: DELETE /instance/logout
  let res = await evoFetch(`${cleanUrl}/instance/logout`, {
    method: 'DELETE',
    headers: { 'apikey': activeKey }
  });

  if (!res.ok) {
    res = await evoFetch(`${cleanUrl}/instance/logout/${instanceName}`, {
      method: 'DELETE',
      headers: { 'apikey': server.apiKey }
    });
  }

  return { ok: res.ok, data: res.data };
}

// 5. Enviar Mensagem de Texto (Master Alert)
async function sendEVOMessage(server, instanceName, destinationPhone, text) {
  if (!server || !server.url || !server.apiKey) return false;

  const cleanUrl = server.url.replace(/\/$/, '');
  const cleanPhone = destinationPhone.replace(/\D/g, '');

  const payload = {
    number: cleanPhone,
    options: { delay: 1200, presence: 'composing' },
    textMessage: { text },
    text
  };

  const res = await evoFetch(`${cleanUrl}/message/sendText/${instanceName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': server.apiKey },
    body: JSON.stringify(payload)
  });

  return res.ok;
}

// 6. Criar Instância na Evolution API / Evolution Go
async function createEVOInstance(server, instanceName) {
  if (!server || !server.url || !server.apiKey) {
    return { ok: false, message: 'Servidor EVO não configurado' };
  }

  const cleanUrl = server.url.replace(/\/$/, '');
  const payload = {
    instanceName: instanceName,
    name: instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS'
  };

  const res = await evoFetch(`${cleanUrl}/instance/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': server.apiKey },
    body: JSON.stringify(payload)
  });

  return { ok: res.ok, data: res.data };
}

// ----------------------------------------------------
// SINCRONIZAÇÃO AUTOMÁTICA DE INSTÂNCIAS
// ----------------------------------------------------
async function syncAllInstances() {
  const db = loadDB();
  let addedCount = 0;

  for (let server of db.servers) {
    const remoteInstances = await fetchServerInstances(server);

    for (let remoteInst of remoteInstances) {
      if (!remoteInst.name) continue;

      const exists = db.clients.find(c => c.serverId === server.id && c.instanceName === remoteInst.name);

      if (!exists) {
        const newClient = {
          id: `client-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          name: remoteInst.name,
          phone: '',
          serverId: server.id,
          instanceName: remoteInst.name,
          token: `token-${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36)}`,
          evoGoToken: remoteInst.token || '',
          lastStatus: remoteInst.status === 'open' ? 'open' : 'close',
          lastAlertSentAt: null,
          autoDiscovered: true
        };

        db.clients.push(newClient);
        addedCount++;
      } else {
        if (remoteInst.token && !exists.evoGoToken) {
          exists.evoGoToken = remoteInst.token;
        }
      }
    }
  }

  if (addedCount > 0) {
    saveDB(db);
    console.log(`[SINCRONIA EVO] ${addedCount} novas instâncias descobertas e integradas ao painel!`);
  }

  return { addedCount, totalClients: db.clients.length };
}

setInterval(syncAllInstances, 120000);

// Monitor de Alertas em Segundo Plano
setInterval(async () => {
  try {
    const db = loadDB();
    if (!db.masterInstance || !db.masterInstance.isEnabled) return;

    const masterServer = db.servers.find(s => s.id === db.masterInstance.serverId);
    if (!masterServer || !db.masterInstance.instanceName) return;

    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;

    for (let client of db.clients) {
      if (!client.phone) continue;

      const clientServer = db.servers.find(s => s.id === client.serverId);
      if (!clientServer) continue;

      const statusRes = await getEVOStatus(clientServer, client.instanceName, client.evoGoToken);
      const previousStatus = client.lastStatus;
      client.lastStatus = statusRes.status === 'CONNECTED' ? 'open' : 'close';

      const wasAlertedRecently = client.lastAlertSentAt && (now - client.lastAlertSentAt < ONE_HOUR);

      if (client.lastStatus === 'close' && (previousStatus === 'open' || !wasAlertedRecently)) {
        const baseUrl = process.env.BASE_URL || `https://painel.dmove.com.br`;
        const clientLink = `${baseUrl}/?token=${client.token}`;

        let message = db.masterInstance.template || 'Atenção! Seu WhatsApp desconectou. Acesse {{link_painel}} para reconectar.';
        message = message
          .replace(/{{nome_cliente}}/g, client.name)
          .replace(/{{nome_instancia}}/g, client.instanceName)
          .replace(/{{link_painel}}/g, clientLink);

        const sent = await sendEVOMessage(masterServer, db.masterInstance.instanceName, client.phone, message);
        if (sent) client.lastAlertSentAt = now;
      }
    }
    saveDB(db);
  } catch (err) {
    console.error('Erro no monitor de status:', err.message);
  }
}, 45000);

// ----------------------------------------------------
// ROTAS DA API PÚBLICA / CLIENTE
// ----------------------------------------------------

app.get('/api/client/config/:token', (req, res) => {
  const db = loadDB();
  const client = db.clients.find(c => c.token === req.params.token);

  if (!client) return res.status(404).json({ error: 'Link de cliente inválido.' });

  return res.json({
    agencyName: db.settings.agencyName || 'EvoConnect',
    logoUrl: db.settings.logoUrl || '',
    primaryColor: db.settings.primaryColor || '#059669',
    clientName: client.name,
    instanceName: client.instanceName
  });
});

app.get('/api/client/status/:token', async (req, res) => {
  const db = loadDB();
  const client = db.clients.find(c => c.token === req.params.token);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

  const server = db.servers.find(s => s.id === client.serverId);
  if (!server) return res.status(400).json({ error: 'Servidor EVO não configurado' });

  const result = await getEVOStatus(server, client.instanceName, client.evoGoToken);
  client.lastStatus = result.status === 'CONNECTED' ? 'open' : 'close';
  saveDB(db);

  return res.json(result);
});

app.get('/api/client/connect/:token', async (req, res) => {
  const db = loadDB();
  const client = db.clients.find(c => c.token === req.params.token);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

  const server = db.servers.find(s => s.id === client.serverId);
  const qrResult = await getEVOQRCode(server, client.instanceName, client.evoGoToken);
  return res.json(qrResult);
});

app.post('/api/client/pairing-code/:token', async (req, res) => {
  const db = loadDB();
  const client = db.clients.find(c => c.token === req.params.token);
  const { phone } = req.body;
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

  const server = db.servers.find(s => s.id === client.serverId);
  const pairingResult = await getEVOPairingCode(server, client.instanceName, phone || client.phone, client.evoGoToken);
  return res.json(pairingResult);
});

app.post('/api/client/logout/:token', async (req, res) => {
  const db = loadDB();
  const client = db.clients.find(c => c.token === req.params.token);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

  const server = db.servers.find(s => s.id === client.serverId);
  const logoutRes = await logoutEVOInstance(server, client.instanceName, client.evoGoToken);
  client.lastStatus = 'close';
  saveDB(db);

  return res.json({ ok: true, logoutRes });
});

// ----------------------------------------------------
// ROTAS DE INTEGRAÇÃO WEBHOOK / N8N / TYPEBOT
// ----------------------------------------------------
app.post('/api/v1/auto-create-client', async (req, res) => {
  const { name, phone, serverId, instanceName, createInEVO } = req.body;
  const db = loadDB();

  if (!name || !instanceName) {
    return res.status(400).json({ error: 'name e instanceName são obrigatórios' });
  }

  const targetServer = serverId ? db.servers.find(s => s.id === serverId) : db.servers[0];
  if (!targetServer) {
    return res.status(400).json({ error: 'Nenhum servidor Evolution API cadastrado.' });
  }

  if (createInEVO) {
    await createEVOInstance(targetServer, instanceName);
  }

  let client = db.clients.find(c => c.serverId === targetServer.id && c.instanceName === instanceName);

  if (!client) {
    client = {
      id: `client-${Date.now()}`,
      name,
      phone: phone ? phone.replace(/\D/g, '') : '',
      serverId: targetServer.id,
      instanceName,
      token: `token-${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36)}`,
      lastStatus: 'close',
      lastAlertSentAt: null
    };
    db.clients.push(client);
    saveDB(db);
  }

  const baseUrl = process.env.BASE_URL || `https://painel.dmove.com.br`;
  const clientUrl = `${baseUrl}/?token=${client.token}`;

  return res.json({
    ok: true,
    client: {
      id: client.id,
      name: client.name,
      instanceName: client.instanceName,
      token: client.token,
      clientUrl
    }
  });
});

// ----------------------------------------------------
// ROTAS DA API - ADMINISTRAÇÃO
// ----------------------------------------------------

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const db = loadDB();
  if (password === db.settings.adminPassword) {
    return res.json({ ok: true, token: 'admin-authenticated-session' });
  }
  return res.status(401).json({ ok: false, error: 'Senha incorreta' });
});

app.get('/api/admin/overview', async (req, res) => {
  const db = loadDB();
  
  let connectedCount = 0;
  let disconnectedCount = 0;

  const clientStatuses = await Promise.all(
    db.clients.map(async (client) => {
      const server = db.servers.find(s => s.id === client.serverId);
      let status = 'DISCONNECTED';
      if (server) {
        const st = await getEVOStatus(server, client.instanceName, client.evoGoToken);
        status = st.status;
      }
      if (status === 'CONNECTED') connectedCount++;
      else disconnectedCount++;

      return {
        ...client,
        currentStatus: status,
        serverName: server ? server.name : 'Nenhum'
      };
    })
  );

  return res.json({
    totalClients: db.clients.length,
    totalServers: db.servers.length,
    connectedCount,
    disconnectedCount,
    masterInstance: db.masterInstance,
    clients: clientStatuses,
    servers: db.servers,
    settings: db.settings
  });
});

app.post('/api/admin/sync-instances', async (req, res) => {
  const syncResult = await syncAllInstances();
  res.json({ ok: true, ...syncResult });
});

app.get('/api/admin/servers', (req, res) => {
  const db = loadDB();
  res.json(db.servers);
});

app.post('/api/admin/servers', (req, res) => {
  const db = loadDB();
  const { name, url, apiKey, version } = req.body;

  if (!name || !url || !apiKey) {
    return res.status(400).json({ error: 'Preencha nome, URL e API Key' });
  }

  const newServer = {
    id: `server-${Date.now()}`,
    name,
    url,
    apiKey,
    version: version || 'v1'
  };

  db.servers.push(newServer);
  saveDB(db);
  res.json({ ok: true, server: newServer });
});

app.delete('/api/admin/servers/:id', (req, res) => {
  const db = loadDB();
  db.servers = db.servers.filter(s => s.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

app.get('/api/admin/servers/:id/instances', async (req, res) => {
  const db = loadDB();
  const server = db.servers.find(s => s.id === req.params.id);
  if (!server) return res.status(404).json({ error: 'Servidor não encontrado' });

  const instances = await fetchServerInstances(server);
  res.json(instances);
});

app.post('/api/admin/clients', async (req, res) => {
  const db = loadDB();
  const { name, phone, serverId, instanceName, createInEVO } = req.body;

  if (!name || !serverId || !instanceName) {
    return res.status(400).json({ error: 'Nome, Servidor e Instância são obrigatórios' });
  }

  const server = db.servers.find(s => s.id === serverId);

  if (createInEVO && server) {
    await createEVOInstance(server, instanceName);
  }

  const newClient = {
    id: `client-${Date.now()}`,
    name,
    phone: phone ? phone.replace(/\D/g, '') : '',
    serverId,
    instanceName,
    token: `token-${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36)}`,
    lastStatus: 'close',
    lastAlertSentAt: null
  };

  db.clients.push(newClient);
  saveDB(db);
  res.json({ ok: true, client: newClient });
});

app.delete('/api/admin/clients/:id', (req, res) => {
  const db = loadDB();
  db.clients = db.clients.filter(c => c.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/admin/master-instance', (req, res) => {
  const db = loadDB();
  const { serverId, instanceName, isEnabled, template } = req.body;

  db.masterInstance = {
    serverId: serverId || '',
    instanceName: instanceName || '',
    isEnabled: isEnabled === true || isEnabled === 'true',
    template: template || db.masterInstance.template
  };

  saveDB(db);
  res.json({ ok: true, masterInstance: db.masterInstance });
});

app.post('/api/admin/master-instance/test', async (req, res) => {
  const db = loadDB();
  const { testPhone } = req.body;

  if (!testPhone) return res.status(400).json({ error: 'Informe um número de teste' });

  const masterServer = db.servers.find(s => s.id === db.masterInstance.serverId);
  if (!masterServer || !db.masterInstance.instanceName) {
    return res.status(400).json({ error: 'Instância Master não configurada' });
  }

  const testMessage = `🧪 *[EvoConnect - Teste de Alerta]*\n\nEste é um teste do seu sistema de notificações para clientes!\nQuando o WhatsApp de um cliente desconectar, ele receberá um aviso como este.`;

  const success = await sendEVOMessage(masterServer, db.masterInstance.instanceName, testPhone, testMessage);

  if (success) {
    return res.json({ ok: true, message: 'Mensagem de teste enviada com sucesso!' });
  } else {
    return res.status(500).json({ error: 'Falha ao enviar mensagem de teste.' });
  }
});

app.post('/api/admin/settings', (req, res) => {
  const db = loadDB();
  const { agencyName, logoUrl, primaryColor, adminPassword } = req.body;

  db.settings = {
    agencyName: agencyName || db.settings.agencyName || 'EvoConnect',
    logoUrl: logoUrl !== undefined ? logoUrl : db.settings.logoUrl,
    primaryColor: primaryColor || db.settings.primaryColor || '#059669',
    adminPassword: adminPassword || db.settings.adminPassword || 'admin',
    apiKey: db.settings.apiKey || 'evoconnect_secret_api_key_2026'
  };

  saveDB(db);
  res.json({ ok: true, settings: db.settings });
});

app.listen(PORT, () => {
  console.log(`🚀 EvoConnect rodando na porta: ${PORT}`);
});
