process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');

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

const defaultEmailSettings = {
  enabled: false,
  host: '',
  port: 587,
  secure: false,
  user: '',
  pass: '',
  fromName: 'EvoConnect Alertas',
  fromEmail: '',
  recipientEmails: '',
  notifyOnDisconnect: true,
  notifyOnConnect: true
};

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
      emailSettings: defaultEmailSettings,
      settings: {
        agencyName: 'EvoConnect',
        logoUrl: '',
        primaryColor: '#059669',
        adminPassword: '*Dmove#10',
        apiKey: 'evoconnect_secret_api_key_2026'
      }
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (data.settings && (data.settings.adminPassword === 'admin' || !data.settings.adminPassword)) {
      data.settings.adminPassword = '*Dmove#10';
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    }
    if (!data.emailSettings) {
      data.emailSettings = defaultEmailSettings;
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    }
    return data;
  } catch (e) {
    return { servers: [], clients: [], masterInstance: {}, emailSettings: defaultEmailSettings, settings: {} };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Helper para envio de e-mails via Nodemailer
async function sendEmailNotification(customSettings, { subject, htmlContent }) {
  const db = loadDB();
  const settings = customSettings || db.emailSettings;

  if (!settings || !settings.enabled || !settings.host || !settings.user || !settings.pass || !settings.recipientEmails) {
    return { ok: false, error: 'Configurações de e-mail incompletas ou desativadas.' };
  }

  const port = parseInt(settings.port, 10) || 587;
  const secure = settings.secure === true || port === 465;

  const transporter = nodemailer.createTransport({
    host: settings.host,
    port,
    secure,
    auth: {
      user: settings.user,
      pass: settings.pass
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  const fromName = settings.fromName || 'EvoConnect Alertas';
  const fromEmail = settings.fromEmail || settings.user;

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: settings.recipientEmails,
      subject,
      html: htmlContent
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[EMAIL ERROR]', err.message);
    return { ok: false, error: err.message };
  }
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

// Helper para testar a saude profunda do socket (Deep Health Check para detectar Conexões Fantasmas)
async function checkDeepSocketHealth(server, instanceName, clientEvoToken = '') {
  if (!server || !server.url || !server.apiKey) return false;
  const cleanUrl = server.url.replace(/\/$/, '');

  // Executa uma consulta leve de verificacao de numero no WhatsApp
  const testUrl = `${cleanUrl}/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`;
  const res = await evoFetch(testUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': server.apiKey },
    body: JSON.stringify({ numbers: ['5511986028866'] })
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 500 || res.status === 404 || res.error) {
      return false; // Socket desincronizado / Conexão Fantasma
    }
  }
  return true;
}

// Helper para forcar o reinício da sessão/socket sem perder a conexao (Restart/Reload)
async function restartEVOInstance(server, instanceName, clientEvoToken = '') {
  if (!server || !server.url || !server.apiKey) return { ok: false };
  const cleanUrl = server.url.replace(/\/$/, '');
  const activeKey = clientEvoToken || server.apiKey;

  // 1. Tenta POST /instance/restart/:name (v2 e v1)
  let res = await evoFetch(`${cleanUrl}/instance/restart/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    headers: { 'apikey': server.apiKey }
  });

  if (res.ok) return { ok: true, data: res.data };

  // 2. Tenta GET /instance/connect/:name (v1 e v2 reload)
  res = await evoFetch(`${cleanUrl}/instance/connect/${encodeURIComponent(instanceName)}`, {
    headers: { 'apikey': server.apiKey }
  });

  if (res.ok) return { ok: true, data: res.data };

  // 3. Evolution Go: POST /instance/connect
  res = await evoFetch(`${cleanUrl}/instance/connect`, {
    method: 'POST',
    headers: { 'apikey': activeKey }
  });

  return { ok: res.ok, data: res.data };
}

// Helper para buscar instâncias remotas (Suporte a Evolution API Node & Evolution Go)
async function fetchServerInstances(server) {
  if (!server || !server.url || !server.apiKey) return [];
  const cleanUrl = server.url.replace(/\/$/, '');

  // 1. Tenta endpoint do Evolution Go (/instance/all ou /instance/fetch)
  let res = await evoFetch(`${cleanUrl}/instance/all`, {
    headers: { 'apikey': server.apiKey }
  });

  if (res.ok) {
    const list = Array.isArray(res.data) 
      ? res.data 
      : (Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data?.response) ? res.data.response : null));

    if (list) {
      return list
        .filter(item => typeof item === 'object' && item && item.name)
        .map(item => ({
          name: item.name || item.instanceName || 'Instância',
          status: item.connected ? 'open' : 'close',
          token: item.token || ''
        }));
    }
  }

  res = await evoFetch(`${cleanUrl}/instance/fetch`, {
    headers: { 'apikey': server.apiKey }
  });

  if (res.ok) {
    const list = Array.isArray(res.data) 
      ? res.data 
      : (Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data?.response) ? res.data.response : null));

    if (list) {
      return list
        .filter(item => typeof item === 'object' && item && item.name)
        .map(item => ({
          name: item.name || item.instanceName || 'Instância',
          status: item.connected ? 'open' : 'close',
          token: item.token || ''
        }));
    }
  }

  // 2. Tenta endpoint padrão v1/v2 Baileys Node (/instance/fetchInstances)
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

// 1. Obter Status da Conexão (v1, v2 e Go) com Detecção de Conexões Fantasmas
async function getEVOStatus(server, instanceName, clientEvoToken = '', skipDeepCheck = false) {
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
    // No Evolution Go: LoggedIn indica se o WhatsApp está realmente autenticado e conectado
    const isConnected = res.data.data.LoggedIn === true;
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
      // Deep Health Check para identificar socket travado (Conexão Fantasma)
      if (!skipDeepCheck) {
        const isSocketAlive = await checkDeepSocketHealth(server, instanceName, clientEvoToken);
        if (!isSocketAlive) {
          return {
            status: 'GHOST',
            phone: res.data?.instance?.owner || res.data?.owner || '',
            profileName: res.data?.instance?.profileName || res.data?.profileName || ''
          };
        }
      }
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
  const found = allInstances.find(i => String(i.name).toLowerCase() === String(instanceName).toLowerCase());
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

  let qrCode = null;
  let pairingCode = null;

  // Evolution Go: tenta /instance/qr usando o token da instância ou apiKey
  let res = await evoFetch(`${cleanUrl}/instance/qr`, {
    headers: { 'apikey': activeKey }
  });

  if (res.ok) {
    qrCode = res.data?.data?.Qrcode || res.data?.data?.qrcode || res.data?.qrcode || res.data?.code || res.data?.base64 || res.data?.qrcode?.base64;
    pairingCode = res.data?.data?.PairingCode || res.data?.data?.pairingCode || res.data?.pairingCode || null;
  }

  if (!qrCode) {
    // Tenta endpoint v1/v2 (/instance/connect/:name)
    res = await evoFetch(`${cleanUrl}/instance/connect/${instanceName}`, {
      headers: { 'apikey': server.apiKey }
    });

    if (res.ok) {
      qrCode = res.data?.code || res.data?.base64 || res.data?.qrcode?.base64 || res.data?.qrcode;
      pairingCode = res.data?.pairingCode || null;
    }
  }

  if (qrCode && typeof qrCode === 'string') {
    // 1. Se a resposta já for uma imagem data:image/png;base64
    if (qrCode.startsWith('data:image')) {
      return { ok: true, qrCode, pairingCode };
    }
    
    // 2. Se for uma string base64 pura de imagem PNG
    if (qrCode.startsWith('iVBORw0KGgo')) {
      return { ok: true, qrCode: `data:image/png;base64,${qrCode}`, pairingCode };
    }

    // 3. Se for a string bruta de QR Code do Baileys (iniciando com 2@ ou texto livre)
    try {
      const generatedPng = await QRCode.toDataURL(qrCode, { margin: 2, width: 320 });
      return { ok: true, qrCode: generatedPng, pairingCode };
    } catch (err) {
      const fallbackUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrCode)}`;
      return { ok: true, qrCode: fallbackUrl, pairingCode };
    }
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
    const code = res.data?.data?.PairingCode || res.data?.data?.pairingCode || res.data?.pairingCode || res.data?.code || res.data?.data?.code;
    if (code && typeof code === 'string' && code.length < 20 && !code.startsWith('2@')) {
      return { ok: true, pairingCode: code };
    }
  }

  // Evolution API v1/v2 Baileys: GET /instance/connect/:name?number=...
  res = await evoFetch(`${cleanUrl}/instance/connect/${instanceName}?number=${cleanPhone}`, {
    headers: { 'apikey': server.apiKey }
  });

  if (res.ok) {
    const code = res.data?.pairingCode || res.data?.code;
    if (code && typeof code === 'string' && code.length < 20 && !code.startsWith('2@')) {
      return { ok: true, pairingCode: code };
    }
  }

  return { 
    ok: false, 
    message: 'Esta versão da Evolution API não suporta Código de Pareamento via API. Por favor, utilize a leitura do QR Code.' 
  };
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
  const generatedToken = `token-${Math.random().toString(36).substring(2, 12)}${Date.now().toString(36)}`;

  // Payload universal (funciona tanto para Evolution Baileys v1/v2 quanto Evolution Go)
  const payload = {
    instanceName: instanceName,
    name: instanceName,
    token: generatedToken,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS'
  };

  const res = await evoFetch(`${cleanUrl}/instance/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': server.apiKey },
    body: JSON.stringify(payload)
  });

  const evoGoToken = res.data?.data?.token || res.data?.token || generatedToken;

  return { ok: res.ok, data: res.data, evoGoToken };
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

      const cleanRemoteName = String(remoteInst.name).trim();

      // Busca cliente existente no mesmo servidor ou por nome de instância
      let exists = db.clients.find(c => c.serverId === server.id && String(c.instanceName).toLowerCase() === cleanRemoteName.toLowerCase());

      if (!exists) {
        // Se não encontrou no mesmo servidor, busca em qualquer servidor para evitar duplicidade
        exists = db.clients.find(c => String(c.instanceName).toLowerCase() === cleanRemoteName.toLowerCase());
      }

      if (!exists) {
        const newClient = {
          id: `client-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          name: cleanRemoteName,
          phone: '',
          serverId: server.id,
          instanceName: cleanRemoteName,
          token: `token-${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36)}`,
          evoGoToken: remoteInst.token || '',
          lastStatus: remoteInst.status === 'open' ? 'open' : 'close',
          lastAlertSentAt: null,
          autoDiscovered: true
        };

        db.clients.push(newClient);
        addedCount++;
      } else {
        // Atualiza a associação do servidor e token Go caso necessário
        if (remoteInst.token && (!exists.evoGoToken || exists.evoGoToken !== remoteInst.token)) {
          exists.evoGoToken = remoteInst.token;
        }
        if (exists.serverId !== server.id && remoteInst.token) {
          exists.serverId = server.id;
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

// Monitor de Alertas em Segundo Plano (WhatsApp + E-mail + Detecção de Conexões Fantasmas)
setInterval(async () => {
  try {
    const db = loadDB();
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;

    const masterServer = (db.masterInstance && db.masterInstance.isEnabled) 
      ? db.servers.find(s => s.id === db.masterInstance.serverId) 
      : null;

    const emailCfg = db.emailSettings || {};
    const baseUrl = process.env.BASE_URL || `https://painel.dmove.com.br`;

    for (let client of db.clients) {
      const clientServer = db.servers.find(s => s.id === client.serverId);
      if (!clientServer) continue;

      const statusRes = await getEVOStatus(clientServer, client.instanceName, client.evoGoToken);
      const previousStatus = client.lastStatus; // 'open', 'close', ou 'ghost'
      
      let newStatus = 'close';
      if (statusRes.status === 'CONNECTED') newStatus = 'open';
      else if (statusRes.status === 'GHOST') newStatus = 'ghost';

      client.lastStatus = newStatus;

      const clientLink = `${baseUrl}/?token=${client.token}`;

      // 1. CONEXÃO FANTASMA DETECTADA (👻)
      if (newStatus === 'ghost') {
        console.log(`[ALERTAS] 👻 Conexão Fantasma detectada na instância ${client.instanceName} (${client.name}). Tentando auto-restart...`);
        
        // Dispara auto-restart do socket para ressuscitar a conexão
        await restartEVOInstance(clientServer, client.instanceName, client.evoGoToken);

        const wasAlertedRecently = client.lastAlertSentAt && (now - client.lastAlertSentAt < ONE_HOUR);

        if (!wasAlertedRecently) {
          if (emailCfg.enabled && emailCfg.recipientEmails) {
            const subject = `👻 [ALERTA EVOCONNECT] Conexão Fantasma Detectada - ${client.name} (${client.instanceName})`;
            const htmlContent = `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #ffffff;">
                <div style="background: #8b5cf6; color: white; padding: 20px; text-align: center;">
                  <h1 style="margin: 0; font-size: 20px;">👻 Conexão Fantasma (Socket Travado) Detectada</h1>
                </div>
                <div style="padding: 24px; color: #1e293b; line-height: 1.6;">
                  <p>Atenção! O sistema identificou que a seguinte instância está em estado de <strong>Conexão Fantasma</strong> (reporta "Conectado" na Evolution mas o socket do WhatsApp não responde):</p>
                  <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #f8fafc; border-radius: 6px;">
                    <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Cliente:</strong></td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>${client.name}</strong></td></tr>
                    <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Instância:</strong></td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><code>${client.instanceName}</code></td></tr>
                    <tr><td style="padding: 10px;"><strong>Servidor:</strong></td><td style="padding: 10px;">${clientServer.name}</td></tr>
                  </table>
                  <p style="background: #f3e8ff; border: 1px solid #d8b4fe; padding: 12px; border-radius: 6px; color: #6b21a8; font-size: 14px;">
                    ⚡ O EvoConnect enviou automaticamente um comando de <strong>Reinício de Socket</strong> para ressuscitar a conexão sem necessidade de novo QR Code.
                  </p>
                  <div style="text-align: center; margin: 30px 0;">
                    <a href="${clientLink}" target="_blank" style="background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">🔗 Acessar Link de Reconexão do Cliente</a>
                  </div>
                  <p style="font-size: 13px; color: #64748b;">Este alerta automático foi gerado pelo sistema EvoConnect.</p>
                </div>
              </div>
            `;
            sendEmailNotification(emailCfg, { subject, htmlContent });
          }
          client.lastAlertSentAt = now;
        }
      }

      // 2. ALERTA DE DESCONEXÃO POR E-MAIL (🔴)
      if (previousStatus === 'open' && newStatus === 'close') {
        console.log(`[ALERTAS] Instância ${client.instanceName} (${client.name}) DESCONECTOU!`);

        if (emailCfg.enabled && emailCfg.notifyOnDisconnect !== false && emailCfg.recipientEmails) {
          const subject = `🔴 [ALERTA EVOCONNECT] Conexão Desconectada - ${client.name} (${client.instanceName})`;
          const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #ffffff;">
              <div style="background: #ef4444; color: white; padding: 20px; text-align: center;">
                <h1 style="margin: 0; font-size: 20px;">⚠️ Instância WhatsApp Desconectada</h1>
              </div>
              <div style="padding: 24px; color: #1e293b; line-height: 1.6;">
                <p>Atenção! Identificamos que a seguinte conexão do WhatsApp foi <strong>DESCONECTADA</strong>:</p>
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #f8fafc; border-radius: 6px;">
                  <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Cliente:</strong></td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>${client.name}</strong></td></tr>
                  <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Instância:</strong></td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><code>${client.instanceName}</code></td></tr>
                  <tr><td style="padding: 10px;"><strong>Servidor:</strong></td><td style="padding: 10px;">${clientServer.name}</td></tr>
                </table>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${clientLink}" target="_blank" style="background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">🔗 Acessar Link de Reconexão do Cliente</a>
                </div>
                <p style="font-size: 13px; color: #64748b;">Este alerta automático foi gerado pelo sistema EvoConnect.</p>
              </div>
            </div>
          `;
          sendEmailNotification(emailCfg, { subject, htmlContent });
        }
      }

      // 3. ALERTA DE RECONEXÃO POR E-MAIL (🟢)
      if ((previousStatus === 'close' || previousStatus === 'ghost') && newStatus === 'open') {
        console.log(`[ALERTAS] Instância ${client.instanceName} (${client.name}) RECONECTADA!`);

        if (emailCfg.enabled && emailCfg.notifyOnConnect !== false && emailCfg.recipientEmails) {
          const subject = `🟢 [EVOCONNECT] Conexão Restabelecida - ${client.name} (${client.instanceName})`;
          const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #ffffff;">
              <div style="background: #10b981; color: white; padding: 20px; text-align: center;">
                <h1 style="margin: 0; font-size: 20px;">🎉 Instância WhatsApp Reconectada!</h1>
              </div>
              <div style="padding: 24px; color: #1e293b; line-height: 1.6;">
                <p>Ótimas notícias! A conexão do WhatsApp foi <strong>RESTABELECIDA</strong> com sucesso:</p>
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: #f8fafc; border-radius: 6px;">
                  <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Cliente:</strong></td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>${client.name}</strong></td></tr>
                  <tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><strong>Instância:</strong></td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><code>${client.instanceName}</code></td></tr>
                  <tr><td style="padding: 10px;"><strong>Servidor:</strong></td><td style="padding: 10px;">${clientServer.name}</td></tr>
                </table>
                <p style="font-size: 13px; color: #64748b;">Este alerta automático foi gerado pelo sistema EvoConnect.</p>
              </div>
            </div>
          `;
          sendEmailNotification(emailCfg, { subject, htmlContent });
        }
      }

      // 4. WHATSAPP MASTER ALERT (se o cliente tiver telefone cadastrado)
      if (client.phone && masterServer && db.masterInstance.instanceName) {
        const wasAlertedRecently = client.lastAlertSentAt && (now - client.lastAlertSentAt < ONE_HOUR);
        if (client.lastStatus === 'close' && (previousStatus === 'open' || !wasAlertedRecently)) {
          let message = db.masterInstance.template || 'Atenção! Seu WhatsApp desconectou. Acesse {{link_painel}} para reconectar.';
          message = message
            .replace(/{{nome_cliente}}/g, client.name)
            .replace(/{{nome_instancia}}/g, client.instanceName)
            .replace(/{{link_painel}}/g, clientLink);

          const sent = await sendEVOMessage(masterServer, db.masterInstance.instanceName, client.phone, message);
          if (sent) client.lastAlertSentAt = now;
        }
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
  client.lastStatus = result.status === 'CONNECTED' ? 'open' : (result.status === 'GHOST' ? 'ghost' : 'close');
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

  let evoGoToken = '';
  if (createInEVO) {
    const createRes = await createEVOInstance(targetServer, instanceName);
    if (createRes.evoGoToken) evoGoToken = createRes.evoGoToken;
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
      evoGoToken,
      lastStatus: 'close',
      lastAlertSentAt: null
    };
    db.clients.push(client);
    saveDB(db);
  } else if (evoGoToken) {
    client.evoGoToken = evoGoToken;
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
  let ghostCount = 0;

  const clientStatuses = await Promise.all(
    db.clients.map(async (client) => {
      const server = db.servers.find(s => s.id === client.serverId);
      let status = 'DISCONNECTED';
      if (server) {
        const st = await getEVOStatus(server, client.instanceName, client.evoGoToken);
        status = st.status;
      }
      if (status === 'CONNECTED') connectedCount++;
      else if (status === 'GHOST') {
        ghostCount++;
        disconnectedCount++;
      } else {
        disconnectedCount++;
      }

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
    ghostCount,
    masterInstance: db.masterInstance,
    emailSettings: db.emailSettings || defaultEmailSettings,
    clients: clientStatuses,
    servers: db.servers,
    settings: db.settings
  });
});

app.post('/api/admin/instances/restart', async (req, res) => {
  const { clientId } = req.body;
  const db = loadDB();

  const client = db.clients.find(c => c.id === clientId);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });

  const server = db.servers.find(s => s.id === client.serverId);
  if (!server) return res.status(400).json({ error: 'Servidor EVO não encontrado.' });

  const restartResult = await restartEVOInstance(server, client.instanceName, client.evoGoToken);

  return res.json({
    ok: restartResult.ok,
    message: restartResult.ok 
      ? `Comando de reinício do socket enviado com sucesso para ${client.instanceName}!` 
      : 'Não foi possível reiniciar o socket da instância.',
    data: restartResult.data
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

  let evoGoToken = '';
  if (createInEVO && server) {
    const createRes = await createEVOInstance(server, instanceName);
    if (createRes.evoGoToken) evoGoToken = createRes.evoGoToken;
  }

  const newClient = {
    id: `client-${Date.now()}`,
    name,
    phone: phone ? phone.replace(/\D/g, '') : '',
    serverId,
    instanceName,
    token: `token-${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36)}`,
    evoGoToken,
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

// Configurações de E-mail SMTP
app.get('/api/admin/email-settings', (req, res) => {
  const db = loadDB();
  res.json(db.emailSettings || defaultEmailSettings);
});

app.post('/api/admin/email-settings', (req, res) => {
  const db = loadDB();
  const { enabled, host, port, secure, user, pass, fromName, fromEmail, recipientEmails, notifyOnDisconnect, notifyOnConnect } = req.body;

  db.emailSettings = {
    enabled: enabled === true || enabled === 'true',
    host: host || '',
    port: parseInt(port, 10) || 587,
    secure: secure === true || secure === 'true',
    user: user || '',
    pass: pass !== undefined && pass !== '' ? pass : (db.emailSettings?.pass || ''),
    fromName: fromName || 'EvoConnect Alertas',
    fromEmail: fromEmail || user || '',
    recipientEmails: recipientEmails || '',
    notifyOnDisconnect: notifyOnDisconnect !== false && notifyOnDisconnect !== 'false',
    notifyOnConnect: notifyOnConnect !== false && notifyOnConnect !== 'false'
  };

  saveDB(db);
  res.json({ ok: true, emailSettings: db.emailSettings });
});

app.post('/api/admin/email-settings/test', async (req, res) => {
  const { host, port, secure, user, pass, fromName, fromEmail, recipientEmails } = req.body;
  const db = loadDB();

  const testConfig = {
    enabled: true,
    host: host || db.emailSettings?.host,
    port: port || db.emailSettings?.port || 587,
    secure: secure !== undefined ? (secure === true || secure === 'true') : db.emailSettings?.secure,
    user: user || db.emailSettings?.user,
    pass: pass || db.emailSettings?.pass,
    fromName: fromName || db.emailSettings?.fromName || 'EvoConnect Alertas',
    fromEmail: fromEmail || db.emailSettings?.fromEmail || user || db.emailSettings?.user,
    recipientEmails: recipientEmails || db.emailSettings?.recipientEmails
  };

  if (!testConfig.host || !testConfig.user || !testConfig.pass || !testConfig.recipientEmails) {
    return res.status(400).json({ error: 'Preencha o servidor SMTP, Usuário, Senha e E-mail de destino para realizar o teste.' });
  }

  const subject = `🧪 [TESTE EVOCONNECT] Notificações por E-mail Funcionando!`;
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #ffffff;">
      <div style="background: #059669; color: white; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 20px;">🧪 Teste de E-mail EvoConnect</h1>
      </div>
      <div style="padding: 24px; color: #1e293b; line-height: 1.6;">
        <p>Parabéns! Suas configurações de e-mail SMTP estão <strong>100% funcionais</strong>.</p>
        <p>A partir de agora, você receberá notificações automáticas quando conexões do WhatsApp caírem ou forem restabelecidas.</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="font-size: 12px; color: #64748b;">Enviado via EvoConnect Dashboard em ${new Date().toLocaleString('pt-BR')}.</p>
      </div>
    </div>
  `;

  const result = await sendEmailNotification(testConfig, { subject, htmlContent });

  if (result.ok) {
    return res.json({ ok: true, message: `E-mail de teste enviado com sucesso para: ${testConfig.recipientEmails}` });
  } else {
    return res.status(500).json({ error: `Falha ao enviar e-mail: ${result.error}` });
  }
});

app.post('/api/admin/settings', (req, res) => {
  const db = loadDB();
  const { agencyName, logoUrl, primaryColor, adminPassword } = req.body;

  db.settings = {
    agencyName: agencyName || db.settings.agencyName || 'EvoConnect',
    logoUrl: logoUrl !== undefined ? logoUrl : db.settings.logoUrl,
    primaryColor: primaryColor || db.settings.primaryColor || '#059669',
    adminPassword: adminPassword || db.settings.adminPassword || '*Dmove#10',
    apiKey: db.settings.apiKey || 'evoconnect_secret_api_key_2026'
  };

  saveDB(db);
  res.json({ ok: true, settings: db.settings });
});

app.listen(PORT, () => {
  console.log(`🚀 EvoConnect rodando na porta: ${PORT}`);
});
