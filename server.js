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
// ADAPTADOR UNIVERSAL EVOLUTION API (v1 e v2)
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

// 1. Obter Status da Conexão
async function getEVOStatus(server, instanceName) {
  if (!server || !server.url || !server.apiKey) {
    return { status: 'DISCONNECTED', raw: 'Servidor EVO não configurado' };
  }

  const cleanUrl = server.url.replace(/\/$/, '');
  const endpoint = `${cleanUrl}/instance/connectionState/${instanceName}`;

  const res = await evoFetch(endpoint, {
    headers: { 'apikey': server.apiKey }
  });

  if (!res.ok) {
    return { status: 'DISCONNECTED', raw: res.error || res.data };
  }

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

// 2. Obter QR Code
async function getEVOQRCode(server, instanceName) {
  if (!server || !server.url || !server.apiKey) {
    return { ok: false, message: 'Servidor EVO não configurado' };
  }

  const cleanUrl = server.url.replace(/\/$/, '');
  const endpoint = `${cleanUrl}/instance/connect/${instanceName}`;

  const res = await evoFetch(endpoint, {
    headers: { 'apikey': server.apiKey }
  });

  if (!res.ok) {
    return { ok: false, message: res.data?.message || 'Falha ao buscar QR Code na EVO' };
  }

  let qrCode = res.data?.code || res.data?.base64 || res.data?.qrcode?.base64 || res.data?.qrcode;
  let pairingCode = res.data?.pairingCode || null;

  if (qrCode && !qrCode.startsWith('data:image')) {
    qrCode = `data:image/png;base64,${qrCode}`;
  }

  return { ok: true, qrCode, pairingCode };
}

// 3. Gerar Código de Pareamento
async function getEVOPairingCode(server, instanceName, phoneNumber) {
  if (!server || !server.url || !server.apiKey) {
    return { ok: false, message: 'Servidor EVO não configurado' };
  }

  const cleanUrl = server.url.replace(/\/$/, '');
  const endpoint = `${cleanUrl}/instance/connect/${instanceName}?number=${phoneNumber.replace(/\D/g, '')}`;

  const res = await evoFetch(endpoint, {
    method: 'GET',
    headers: { 'apikey': server.apiKey }
  });

  if (!res.ok) {
    return { ok: false, message: res.data?.message || 'Erro ao gerar código de pareamento' };
  }

  const code = res.data?.pairingCode || res.data?.code;
  return { ok: true, pairingCode: code };
}

// 4. Logout / Desconectar
async function logoutEVOInstance(server, instanceName) {
  if (!server || !server.url || !server.apiKey) {
    return { ok: false, message: 'Servidor EVO não configurado' };
  }

  const cleanUrl = server.url.replace(/\/$/, '');
  const endpoint = `${cleanUrl}/instance/logout/${instanceName}`;

  const res = await evoFetch(endpoint, {
    method: 'DELETE',
    headers: { 'apikey': server.apiKey }
  });

  return { ok: res.ok, data: res.data };
}

// 5. Enviar Mensagem de Texto (Master Alert)
async function sendEVOMessage(server, instanceName, destinationPhone, text) {
  if (!server || !server.url || !server.apiKey) return false;

  const cleanUrl = server.url.replace(/\/$/, '');
  const endpoint = `${cleanUrl}/message/sendText/${instanceName}`;

  const payload = {
    number: destinationPhone.replace(/\D/g, ''),
    options: { delay: 1200, presence: 'composing' },
    textMessage: { text },
    text
  };

  const res = await evoFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': server.apiKey
    },
    body: JSON.stringify(payload)
  });

  return res.ok;
}

// 6. Listar Instâncias Existentes no Servidor EVO
async function fetchServerInstances(server) {
  if (!server || !server.url || !server.apiKey) return [];
  const cleanUrl = server.url.replace(/\/$/, '');
  const endpoint = `${cleanUrl}/instance/fetchInstances`;

  const res = await evoFetch(endpoint, {
    headers: { 'apikey': server.apiKey }
  });

  if (!res.ok || !Array.isArray(res.data)) return [];

  return res.data.map(item => ({
    name: item.instance?.instanceName || item.name || item.instanceName || 'Instância',
    status: item.instance?.status || item.instance?.state || item.status || 'unknown'
  }));
}

// 7. Criar Instância Direto na Evolution API (Vice-Versa)
async function createEVOInstance(server, instanceName) {
  if (!server || !server.url || !server.apiKey) {
    return { ok: false, message: 'Servidor EVO não configurado' };
  }

  const cleanUrl = server.url.replace(/\/$/, '');
  const endpoint = `${cleanUrl}/instance/create`;

  const payload = {
    instanceName: instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS'
  };

  const res = await evoFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': server.apiKey
    },
    body: JSON.stringify(payload)
  });

  return { ok: res.ok, data: res.data };
}

// ----------------------------------------------------
// SINCRONIZAÇÃO AUTOMÁTICA DE INSTÂNCIAS (SINCRONIA TOTAL)
// ----------------------------------------------------
async function syncAllInstances() {
  const db = loadDB();
  let addedCount = 0;

  for (let server of db.servers) {
    const remoteInstances = await fetchServerInstances(server);

    for (let remoteInst of remoteInstances) {
      if (!remoteInst.name) continue;

      // Verifica se a instância já está cadastrada no EvoConnect
      const exists = db.clients.find(c => c.serverId === server.id && c.instanceName === remoteInst.name);

      if (!exists) {
        // Auto-cria o cliente no EvoConnect
        const newClient = {
          id: `client-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          name: remoteInst.name,
          phone: '',
          serverId: server.id,
          instanceName: remoteInst.name,
          token: `token-${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36)}`,
          lastStatus: remoteInst.status === 'open' ? 'open' : 'close',
          lastAlertSentAt: null,
          autoDiscovered: true
        };

        db.clients.push(newClient);
        addedCount++;
      }
    }
  }

  if (addedCount > 0) {
    saveDB(db);
    console.log(`[SINCRONIA EVO] ${addedCount} novas instâncias descobertas e integradas ao painel!`);
  }

  return { addedCount, totalClients: db.clients.length };
}

// Auto-sincronização a cada 2 minutos
setInterval(syncAllInstances, 120000);

// Monitor de Alertas em Segundo Plano (cada 45s)
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

      const statusRes = await getEVOStatus(clientServer, client.instanceName);
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

  if (!client) {
    return res.status(404).json({ error: 'Link de cliente inválido ou expirado.' });
  }

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

  const result = await getEVOStatus(server, client.instanceName);
  client.lastStatus = result.status === 'CONNECTED' ? 'open' : 'close';
  saveDB(db);

  return res.json(result);
});

app.get('/api/client/connect/:token', async (req, res) => {
  const db = loadDB();
  const client = db.clients.find(c => c.token === req.params.token);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

  const server = db.servers.find(s => s.id === client.serverId);
  const qrResult = await getEVOQRCode(server, client.instanceName);
  return res.json(qrResult);
});

app.post('/api/client/pairing-code/:token', async (req, res) => {
  const db = loadDB();
  const client = db.clients.find(c => c.token === req.params.token);
  const { phone } = req.body;
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

  const server = db.servers.find(s => s.id === client.serverId);
  const pairingResult = await getEVOPairingCode(server, client.instanceName, phone || client.phone);
  return res.json(pairingResult);
});

app.post('/api/client/logout/:token', async (req, res) => {
  const db = loadDB();
  const client = db.clients.find(c => c.token === req.params.token);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

  const server = db.servers.find(s => s.id === client.serverId);
  const logoutRes = await logoutEVOInstance(server, client.instanceName);
  client.lastStatus = 'close';
  saveDB(db);

  return res.json({ ok: true, logoutRes });
});

// ----------------------------------------------------
// ROTAS DE INTEGRAÇÃO WEBHOOK / N8N / TYPEBOT (CRIÇÃO AUTOMÁTICA E RETORNO DE LINK)
// ----------------------------------------------------
app.post('/api/v1/auto-create-client', async (req, res) => {
  const { name, phone, serverId, instanceName, createInEVO } = req.body;
  const db = loadDB();

  if (!name || !instanceName) {
    return res.status(400).json({ error: 'name e instanceName são obrigatórios' });
  }

  // Seleciona servidor ou usa o primeiro cadastrado
  const targetServer = serverId ? db.servers.find(s => s.id === serverId) : db.servers[0];
  if (!targetServer) {
    return res.status(400).json({ error: 'Nenhum servidor Evolution API cadastrado no EvoConnect.' });
  }

  // Se solicitado criar também na EVO
  if (createInEVO) {
    await createEVOInstance(targetServer, instanceName);
  }

  // Verifica se o cliente já existe
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
        const st = await getEVOStatus(server, client.instanceName);
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

// Forçar Sincronização Manual de todas as instâncias da EVO
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

  // Se solicitou criar também direto na Evolution API
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
