document.addEventListener('DOMContentLoaded', () => {
  // Pega o token da URL ?token=xyz
  const urlParams = new URLSearchParams(window.location.search);
  const clientToken = urlParams.get('token');

  const errorScreen = document.getElementById('error-screen');
  const clientScreen = document.getElementById('client-screen');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');

  const connectedState = document.getElementById('connected-state');
  const disconnectedState = document.getElementById('disconnected-state');

  const qrLoading = document.getElementById('qr-loading');
  const qrWrapper = document.getElementById('qr-wrapper');
  const qrImage = document.getElementById('qr-image');
  const qrTimer = document.getElementById('qr-timer');
  const timerSeconds = document.getElementById('timer-seconds');

  const tabQr = document.getElementById('tab-qr');
  const tabPairing = document.getElementById('tab-pairing');
  const qrSection = document.getElementById('qr-section');
  const pairingSection = document.getElementById('pairing-section');

  const btnRequestPairing = document.getElementById('btn-request-pairing');
  const pairingPhoneInput = document.getElementById('pairing-phone');
  const pairingResult = document.getElementById('pairing-result');
  const pairingCodeDisplay = document.getElementById('pairing-code-display');

  const btnForceReconnect = document.getElementById('btn-force-reconnect');

  let statusCheckInterval = null;
  let qrRefreshInterval = null;
  let countdownTimer = null;

  if (!clientToken) {
    showErrorScreen();
    return;
  }

  // 1. Carrega configurações públicas (Branding)
  fetch(`/api/client/config/${clientToken}`)
    .then(res => {
      if (!res.ok) throw new Error('Token inválido');
      return res.json();
    })
    .then(config => {
      // Aplica cor primária e branding
      if (config.primaryColor) {
        document.documentElement.style.setProperty('--primary-color', config.primaryColor);
      }
      if (config.agencyName) {
        document.getElementById('brand-name').textContent = config.agencyName;
        document.getElementById('footer-brand').textContent = config.agencyName;
        document.getElementById('page-title').textContent = `Reconectar WhatsApp | ${config.agencyName}`;
      }
      if (config.logoUrl) {
        document.getElementById('brand-icon').style.display = 'none';
        const img = document.createElement('img');
        img.src = config.logoUrl;
        img.alt = config.agencyName;
        document.getElementById('brand-logo-wrapper').prepend(img);
      }
      if (config.clientName) {
        document.getElementById('client-welcome-name').textContent = config.clientName;
      }
      if (config.instanceName) {
        document.getElementById('instance-name-display').textContent = config.instanceName;
      }

      // Mostra tela do cliente e inicia checagem de status
      clientScreen.style.display = 'block';
      checkStatus();
      statusCheckInterval = setInterval(checkStatus, 4000);
    })
    .catch(err => {
      console.error(err);
      showErrorScreen();
    });

  function showErrorScreen() {
    clientScreen.style.display = 'none';
    errorScreen.style.display = 'block';
  }

  // 2. Checa o Status da Instância no Servidor
  function checkStatus() {
    fetch(`/api/client/status/${clientToken}`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'CONNECTED') {
          renderConnected(data);
        } else if (data.status === 'CONNECTING') {
          renderConnecting();
        } else {
          renderDisconnected();
        }
      })
      .catch(err => {
        console.error('Erro ao checar status:', err);
      });
  }

  function renderConnected(data) {
    statusBadge.className = 'status-badge connected';
    statusText.textContent = 'Conectado';

    connectedState.style.display = 'block';
    disconnectedState.style.display = 'none';

    if (data.phone) {
      document.getElementById('connected-phone-display').textContent = data.phone;
    }

    // Limpa timers de QR Code se estava buscando
    clearInterval(qrRefreshInterval);
    clearInterval(countdownTimer);
    qrRefreshInterval = null;
  }

  function renderConnecting() {
    statusBadge.className = 'status-badge connecting';
    statusText.textContent = 'Conectando...';
  }

  function renderDisconnected() {
    statusBadge.className = 'status-badge disconnected';
    statusText.textContent = 'Desconectado';

    connectedState.style.display = 'none';
    disconnectedState.style.display = 'block';

    // Se estiver na aba QR Code e ainda não iniciou busca contínua de QR Code
    if (!qrRefreshInterval && qrSection.style.display !== 'none') {
      fetchQRCode();
      startQRAutoRefresh();
    }
  }

  // 3. Busca de QR Code ao vivo
  function fetchQRCode() {
    qrLoading.style.display = 'flex';
    qrWrapper.style.display = 'none';

    fetch(`/api/client/connect/${clientToken}`)
      .then(res => res.json())
      .then(data => {
        if (data.ok && data.qrCode) {
          qrImage.src = data.qrCode;
          qrLoading.style.display = 'none';
          qrWrapper.style.display = 'flex';
          qrTimer.style.display = 'block';
          resetCountdown();
        } else {
          console.warn('QR Code não disponível ainda. Tentando novamente...');
        }
      })
      .catch(err => {
        console.error('Erro ao buscar QR Code:', err);
      });
  }

  function startQRAutoRefresh() {
    clearInterval(qrRefreshInterval);
    qrRefreshInterval = setInterval(() => {
      fetchQRCode();
    }, 15000);
  }

  function resetCountdown() {
    clearInterval(countdownTimer);
    let secondsLeft = 15;
    timerSeconds.textContent = secondsLeft;

    countdownTimer = setInterval(() => {
      secondsLeft--;
      if (secondsLeft >= 0) {
        timerSeconds.textContent = secondsLeft;
      }
    }, 1000);
  }

  // 4. Navegação por Abas (QR Code vs Pairing Code)
  tabQr.addEventListener('click', () => {
    tabQr.className = 'btn btn-primary';
    tabPairing.className = 'btn btn-secondary';
    qrSection.style.display = 'block';
    pairingSection.style.display = 'none';
    fetchQRCode();
    startQRAutoRefresh();
  });

  tabPairing.addEventListener('click', () => {
    tabPairing.className = 'btn btn-primary';
    tabQr.className = 'btn btn-secondary';
    qrSection.style.display = 'none';
    pairingSection.style.display = 'block';
    clearInterval(qrRefreshInterval);
    qrRefreshInterval = null;
  });

  // 5. Solicitar Código de Pareamento
  btnRequestPairing.addEventListener('click', () => {
    const phone = pairingPhoneInput.value.trim();
    if (!phone) {
      alert('Por favor, informe seu número de celular com DDD.');
      return;
    }

    btnRequestPairing.disabled = true;
    btnRequestPairing.textContent = 'Gerando Código...';

    fetch(`/api/client/pairing-code/${clientToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    })
      .then(res => res.json())
      .then(data => {
        btnRequestPairing.disabled = false;
        btnRequestPairing.textContent = 'Gerar Código de Pareamento';

        if (data.ok && data.pairingCode) {
          pairingCodeDisplay.textContent = data.pairingCode;
          pairingResult.style.display = 'block';
        } else {
          alert(data.message || 'Não foi possível gerar o código de pareamento. Tente usar o QR Code.');
        }
      })
      .catch(err => {
        btnRequestPairing.disabled = false;
        btnRequestPairing.textContent = 'Gerar Código de Pareamento';
        alert('Erro ao conectar ao servidor.');
      });
  });

  // 6. Botão de Forçar Desconexão
  btnForceReconnect.addEventListener('click', () => {
    if (!confirm('Deseja realmente desconectar a sessão atual para ler um novo QR Code?')) {
      return;
    }

    btnForceReconnect.disabled = true;
    btnForceReconnect.textContent = 'Desconectando...';

    fetch(`/api/client/logout/${clientToken}`, { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        btnForceReconnect.disabled = false;
        btnForceReconnect.textContent = '🔄 Desconectar e Ler Novo QR Code';
        checkStatus();
      })
      .catch(() => {
        btnForceReconnect.disabled = false;
        btnForceReconnect.textContent = '🔄 Desconectar e Ler Novo QR Code';
      });
  });
});
