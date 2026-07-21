const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Path do Banco de Dados JSON
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

// Inicializa diretório e estrutura do DB se não existir
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      servers: [
        {
          id: 'server-demo-1',
          name: 'Evolution API v1 (Demo)',
          url: 'https://evo1.exemplo.com.br',
          apiKey: 'SUA_GLOBAL_API_KEY_AQUI',
          version: 'v1'
        },
        {
          id: 'server-demo-2',
          name: 'Evolution API v2 (Demo)',
          url: 'https://evo2.exemplo.com.br',
          apiKey: 'SUA_GLOBAL_API_KEY_AQUI',
          version: 'v2'
        }
      ],
      clients: [
        {
          id: 'client-1',
          name: 'Cliente Restaurante Silva',
          phone: '5511999998888',
          serverId: 'server-demo-1',
          instanceName: 'silva_whatsapp',
          token: 'token-silva-883921',
          lastStatus: 'close',
          lastAlertSentAt: null
        },
        {
          id: 'client-2',
          name: 'Cliente Clínica Odonto',
          phone: '5511988887777',
          serverId: 'server-demo-2',
          instanceName: 'odonto_whatsapp',
          token: 'token-odonto-472910',
          lastStatus: 'open',
          lastAlertSentAt: null
        }
      ],
      masterInstance: {
        serverId: 'server-demo-1',
        instanceName: 'admin_master_instance',
        isEnabled: true,
        template: 'Olá {{nome_cliente}}! ⚠️\nIdentificamos que a sua conexão do WhatsApp ({{nome_instancia}}) foi desconectada.\n\nAcesse o link abaixo para reconectar seu WhatsApp agora:\n👉 {{link_painel}}'
      },
      settings: {
        agencyName: 'EvoConnect',
        logoUrl: '',
        primaryColor: '#059669',
        adminPassword: 'admin'
      }
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Erro ao ler database.json, criando fallback:', e);
    return { servers: [], clients: [], masterInstance: {}, settings: {} };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ----------------------------------------------------
// ADAPTADOR UNIVERSAL EVOLUTION API (v1 e v2)
// ----------------------------------------------------

// Função auxiliar para fazer requisições HTTP/HTTPS seguras
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

  // Normalização do status entre v1 e v2
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

// 2. Obter QR Code ao vivo
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

  // Extração do QR code (base64 ou code)
  let qrCode = res.data?.code || res.data?.base64 || res.data?.qrcode?.base64 || res.data?.qrcode;
  let pairingCode = res.data?.pairingCode || null;

  if (qrCode && !qrCode.startsWith('data:image')) {
    qrCode = `data:image/png;base64,${qrCode}`;
  }

  return {
    ok: true,
    qrCode,
    pairingCode,
    count: res.data?.count || 1
  };
}

// 3. Gerar Código de Pareamento (Pairing Code)
async function getEVOPairingCode(server, instanceName, phoneNumber) {
  if (!server || !server.url || !server.apiKey) {
    return { ok: false, message: 'Servidor EVO não configurado' };
  }

  const cleanUrl = server.url.replace(/\/$/, '');
  // Endpoint de pareamento por número
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

// 4. Logout / Desconectar Sessão
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

// 5. Enviar Mensagem de Texto (Via Instância Master)
async function sendEVOMessage(server, instanceName, destinationPhone, text) {
  if (!server || !server.url || !server.apiKey) {
    console.error('Master Server não configurado para envio de mensagens');
    return false;
  }

  const cleanUrl = server.url.replace(/\/$/, '');
  const endpoint = `${cleanUrl}/message/sendText/${instanceName}`;

  const cleanPhone = destinationPhone.replace(/\D/g, '');

  const payload = {
    number: cleanPhone,
    options: {
      delay: 1200,
      presence: 'composing'
    },
    textMessage: {
      text: text
    },
    text: text
  };

  const res = await evoFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': server.apiKey
    },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    console.log(`[ALERTA ENVIADO] Mensagem enviada com sucesso para ${cleanPhone} via instância ${instanceName}`);
    return true;
  } else {
    console.error(`[FALHA ALERTA] Erro ao enviar mensagem para ${cleanPhone}:`, res.data || res.error);
    return false;
  }
}

// 6. Listar Instâncias do Servidor (Para o Admin selecionar)
async function fetchServerInstances(server) {
  if (!server || !server.url || !server.apiKey) {
    return [];
  }
  const cleanUrl = server.url.replace(/\/$/, '');
  const endpoint = `${cleanUrl}/instance/fetchInstances`;

  const res = await evoFetch(endpoint, {
    headers: { 'apikey': server.apiKey }
  });

  if (!res.ok || !Array.isArray(res.data)) {
    return [];
  }

  return res.data.map(item => ({
    name: item.instance?.instanceName || item.name || item.instanceName || 'Instância sem nome',
    status: item.instance?.status || item.instance?.state || item.status || 'unknown'
  }));
}

// ----------------------------------------------------
// MONITOR DE STATUS EM SEGUNDO PLANO (ALERTAS)
// ----------------------------------------------------
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

      // Atualiza o status no DB
      const previousStatus = client.lastStatus;
      client.lastStatus = statusRes.status === 'CONNECTED' ? 'open' : 'close';

      // Se desconectou e ainda não enviou alerta nas últimas 1 hora
      const wasAlertedRecently = client.lastAlertSentAt && (now - client.lastAlertSentAt < ONE_HOUR);

      if (client.lastStatus === 'close' && (previousStatus === 'open' || !wasAlertedRecently)) {
        console.log(`[MONITOR] Cliente ${client.name} está offline. Disparando alerta...`);

        // Constrói a mensagem com variáveis
        const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
        const clientLink = `${baseUrl}/?token=${client.token}`;

        let message = db.masterInstance.template || 'Atenção! Seu WhatsApp desconectou. Acesse {{link_painel}} para reconectar.';
        message = message
          .replace(/{{nome_cliente}}/g, client.name)
          .replace(/{{nome_instancia}}/g, client.instanceName)
          .replace(/{{link_painel}}/g, clientLink);

        const sent = await sendEVOMessage(masterServer, db.masterInstance.instanceName, client.phone, message);
        if (sent) {
          client.lastAlertSentAt = now;
        }
      }
    }
    saveDB(db);
  } catch (err) {
    console.error('Erro no ciclo do monitor de status:', err.message);
  }
}, 45000); // Roda a cada 45 segundos

// ----------------------------------------------------
// ROTAS DA API - PORTAL DO CLIENTE (PÚBLICO VIA TOKEN)
// ----------------------------------------------------

// Configurações visuais públicas para o cliente
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

// Status da conexão do cliente
app.get('/api/client/status/:token', async (req, res) => {
  const db = loadDB();
  const client = db.clients.find(c => c.token === req.params.token);

  if (!client) {
    return res.status(404).json({ error: 'Cliente não encontrado' });
  }

  const server = db.servers.find(s => s.id === client.serverId);
  if (!server) {
    return res.status(400).json({ error: 'Servidor EVO não configurado para este cliente' });
  }

  const result = await getEVOStatus(server, client.instanceName);
  
  // Atualiza cache de status
  client.lastStatus = result.status === 'CONNECTED' ? 'open' : 'close';
  saveDB(db);

  return res.json(result);
});

// Obter QR Code do cliente
app.get('/api/client/connect/:token', async (req, res) => {
  const db = loadDB();
  const client = db.clients.find(c => c.token === req.params.token);

  if (!client) {
    return res.status(404).json({ error: 'Cliente não encontrado' });
  }

  const server = db.servers.find(s => s.id === client.serverId);
  if (!server) {
    return res.status(400).json({ error: 'Servidor EVO não associado' });
  }

  const qrResult = await getEVOQRCode(server, client.instanceName);
  return res.json(qrResult);
});

// Gerar Código de Pareamento por Telefone
app.post('/api/client/pairing-code/:token', async (req, res) => {
  const db = loadDB();
  const client = db.clients.find(c => c.token === req.params.token);
  const { phone } = req.body;

  if (!client) {
    return res.status(404).json({ error: 'Cliente não encontrado' });
  }

  const targetPhone = phone || client.phone;
  if (!targetPhone) {
    return res.status(400).json({ error: 'Número de telefone é obrigatório' });
  }

  const server = db.servers.find(s => s.id === client.serverId);
  const pairingResult = await getEVOPairingCode(server, client.instanceName, targetPhone);
  return res.json(pairingResult);
});

// Solicitante de Desconexão / Restart pelo cliente
app.post('/api/client/logout/:token', async (req, res) => {
  const db = loadDB();
  const client = db.clients.find(c => c.token === req.params.token);

  if (!client) {
    return res.status(404).json({ error: 'Cliente não encontrado' });
  }

  const server = db.servers.find(s => s.id === client.serverId);
  const logoutRes = await logoutEVOInstance(server, client.instanceName);
  
  client.lastStatus = 'close';
  saveDB(db);

  return res.json({ ok: true, logoutRes });
});

// ----------------------------------------------------
// ROTAS DA API - PAINEL ADMINISTRATIVO
// ----------------------------------------------------

// Auth simples do admin
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const db = loadDB();
  if (password === db.settings.adminPassword) {
    return res.json({ ok: true, token: 'admin-authenticated-session' });
  }
  return res.status(401).json({ ok: false, error: 'Senha incorreta' });
});

// Stats gerais para o Admin
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

// CRUD Servidores Evolution API
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

// Buscar instâncias disponíveis num servidor específico
app.get('/api/admin/servers/:id/instances', async (req, res) => {
  const db = loadDB();
  const server = db.servers.find(s => s.id === req.params.id);
  if (!server) {
    return res.status(404).json({ error: 'Servidor não encontrado' });
  }

  const instances = await fetchServerInstances(server);
  res.json(instances);
});

// CRUD Clientes
app.post('/api/admin/clients', (req, res) => {
  const db = loadDB();
  const { name, phone, serverId, instanceName } = req.body;

  if (!name || !serverId || !instanceName) {
    return res.status(400).json({ error: 'Nome, Servidor e Nome da Instância são obrigatórios' });
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

// Configurar Instância Master de Alertas
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

// Testar Envio de Alerta Manual
app.post('/api/admin/master-instance/test', async (req, res) => {
  const db = loadDB();
  const { testPhone } = req.body;

  if (!testPhone) {
    return res.status(400).json({ error: 'Informe um número de WhatsApp de teste' });
  }

  const masterServer = db.servers.find(s => s.id === db.masterInstance.serverId);
  if (!masterServer || !db.masterInstance.instanceName) {
    return res.status(400).json({ error: 'Instância Master não configurada corretamente.' });
  }

  const testMessage = `🧪 *[EvoConnect - Teste de Alerta]*\n\nEste é um teste do seu sistema de notificações para clientes!\nQuando o WhatsApp de um cliente desconectar, ele receberá uma mensagem como esta.`;

  const success = await sendEVOMessage(masterServer, db.masterInstance.instanceName, testPhone, testMessage);

  if (success) {
    return res.json({ ok: true, message: 'Mensagem de teste enviada com sucesso!' });
  } else {
    return res.status(500).json({ error: 'Falha ao enviar mensagem de teste. Verifique se a Instância Master está conectada.' });
  }
});

// Configurações de White-Label
app.post('/api/admin/settings', (req, res) => {
  const db = loadDB();
  const { agencyName, logoUrl, primaryColor, adminPassword } = req.body;

  db.settings = {
    agencyName: agencyName || db.settings.agencyName || 'EvoConnect',
    logoUrl: logoUrl !== undefined ? logoUrl : db.settings.logoUrl,
    primaryColor: primaryColor || db.settings.primaryColor || '#059669',
    adminPassword: adminPassword || db.settings.adminPassword || 'admin'
  };

  saveDB(db);
  res.json({ ok: true, settings: db.settings });
});

// Webhook da Evolution API para atualização em tempo real (opcional)
app.post('/api/webhooks/evo-status', async (req, res) => {
  console.log('[WEBHOOK EVO RECEBIDO]', req.body);
  const body = req.body || {};
  
  // Captura nome da instância e evento
  const instanceName = body.instance || body.instanceName;
  const state = body.data?.state || body.data?.status || body.state || body.status;

  if (instanceName && state) {
    const db = loadDB();
    const client = db.clients.find(c => c.instanceName === instanceName);
    if (client) {
      client.lastStatus = (state === 'open' || state === 'connected') ? 'open' : 'close';
      saveDB(db);
      console.log(`[WEBHOOK] Status do cliente ${client.name} atualizado para: ${client.lastStatus}`);
    }
  }

  res.json({ received: true });
});

app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 EvoConnect - Painel de Reconexão Evolution API`);
  console.log(`🌐 Servidor rodando na porta: ${PORT}`);
  console.log(`🔗 Portal do Cliente: http://localhost:${PORT}/?token=TOKEN_DO_CLIENTE`);
  console.log(`🔑 Painel Administrativo: http://localhost:${PORT}/admin.html`);
  console.log(`===================================================`);
});
