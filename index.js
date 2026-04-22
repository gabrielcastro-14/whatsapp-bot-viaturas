const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');

// Configuração Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Estado das conversas
const conversationState = new Map();

// Configuração
const CONFIG = {
  sendDay: 1, // Segunda-feira
  sendHour: 9,
  sendMinute: 0
};

// ===== FUNÇÕES PRINCIPAIS =====

async function startBot() {
  console.log('🚀 Iniciando bot WhatsApp...');

  const { state, saveCreds } = await useMultiFileAuthState('./auth');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text = 
      msg.message.conversation || 
      msg.message.extendedTextMessage?.text || '';

    console.log(`📩 Mensagem de ${from}: ${text}`);

    await handleMessage(sock, from, text);
  });

  scheduleWeeklyMessages(sock);

  console.log('✅ Bot ativo e pronto!');
  console.log(`📅 Próximo envio: ${getNextSendDate().toLocaleString('pt-PT')}`);
}

// ===== BUSCAR EQUIPAMENTOS DO COLABORADOR =====

async function getUserEquipment(telefone) {
  // Remover @s.whatsapp.net e caracteres extras
  const cleanPhone = telefone.replace('@s.whatsapp.net', '').replace(/\D/g, '');
  
  // Buscar colaborador pelo telefone
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, nome')
    .eq('telefone', cleanPhone)
    .single();

  if (userError || !user) {
    console.log('❌ Colaborador não encontrado:', cleanPhone);
    return null;
  }

  console.log(`✅ Colaborador encontrado: ${user.nome}`);

  const equipment = [];

  // 1. BUSCAR VEHICLES
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, matricula, marca, modelo, km_atual')
    .eq('responsaveloperacional', user.id)
    .eq('status', 'disponivel');

  if (vehicles && vehicles.length > 0) {
    vehicles.forEach(v => {
      equipment.push({
        type: 'vehicle',
        id: v.id,
        identifier: v.matricula,
        description: `${v.marca} ${v.modelo}`,
        current: v.km_atual || 0,
        unit: 'km'
      });
    });
  }

  // 2. BUSCAR TRUCKS
  const { data: trucks } = await supabase
    .from('trucks')
    .select('id, matricula, marca, modelo, km_atual')
    .eq('responsaveloperacional', user.id)
    .eq('status', 'disponivel');

  if (trucks && trucks.length > 0) {
    trucks.forEach(t => {
      equipment.push({
        type: 'truck',
        id: t.id,
        identifier: t.matricula,
        description: `${t.marca} ${t.modelo}`,
        current: t.km_atual || 0,
        unit: 'km'
      });
    });
  }

  // 3. BUSCAR MACHINES
  const { data: machines } = await supabase
    .from('machines')
    .select('id, nome, marca, horas_atual')
    .eq('responsaveloperacional', user.id)
    .eq('status', 'disponivel');

  if (machines && machines.length > 0) {
    machines.forEach(m => {
      equipment.push({
        type: 'machine',
        id: m.id,
        identifier: m.id,
        description: `${m.nome} - ${m.marca}`,
        current: m.horas_atual || 0,
        unit: 'horas'
      });
    });
  }

  return {
    user,
    equipment
  };
}

// ===== LÓGICA DE CONVERSAÇÃO =====

async function handleMessage(sock, from, text) {
  let state = conversationState.get(from);

  // INÍCIO DA CONVERSA
  if (!state || text.toLowerCase().includes('começar')) {
    const data = await getUserEquipment(from);

    if (!data || !data.equipment || data.equipment.length === 0) {
      await sock.sendMessage(from, {
        text: '❌ Não foram encontrados equipamentos atribuídos a si.\n\n' +
              'Se acha que isto é um erro, contacte o administrador.'
      });
      conversationState.delete(from);
      return;
    }

    // Iniciar conversa
    state = {
      userName: data.user.nome,
      equipment: data.equipment,
      currentIndex: 0,
      responses: []
    };

    conversationState.set(from, state);

    await askCurrentEquipment(sock, from, state);
    return;
  }

  // PROCESSAR RESPOSTA
  if (state && state.currentIndex < state.equipment.length) {
    const current = state.equipment[state.currentIndex];
    const value = parseInt(text.replace(/\D/g, ''));

    // Validar número
    if (isNaN(value) || value < 0) {
      await sock.sendMessage(from, {
        text: `⚠️ Por favor indique um número válido de ${current.unit}.\n\n` +
              'Exemplo: 45000'
      });
      return;
    }

    // Validar valor razoável
    if (current.unit === 'km' && value > 999999) {
      await sock.sendMessage(from, {
        text: '⚠️ Valor muito alto para quilómetros. Verifique se está correto.\n\n' +
              'Tente novamente:'
      });
      return;
    }

    if (current.unit === 'horas' && value > 99999) {
      await sock.sendMessage(from, {
        text: '⚠️ Valor muito alto para horas. Verifique se está correto.\n\n' +
              'Tente novamente:'
      });
      return;
    }

    // Guardar resposta
    state.responses.push({
      equipment: current,
      value: value
    });

    // Avançar para próximo equipamento
    state.currentIndex++;
    conversationState.set(from, state);

    // Verificar se acabou
    if (state.currentIndex >= state.equipment.length) {
      await finishConversation(sock, from, state);
    } else {
      await askCurrentEquipment(sock, from, state);
    }
  }
}

async function askCurrentEquipment(sock, from, state) {
  const current = state.equipment[state.currentIndex];
  const total = state.equipment.length;
  const position = state.currentIndex + 1;

  let message;

  if (state.currentIndex === 0) {
    message = `👋 Olá *${state.userName}*!\n\n` +
              `📋 Encontrei *${total}* equipamento(s) atribuído(s) a si.\n` +
              `Vamos registar os valores atuais.\n\n` +
              `━━━━━━━━━━━━━━━━\n\n`;
  } else {
    message = `✅ Registado!\n\n`;
  }

  message += `📊 Equipamento *${position}/${total}*\n\n` +
             `🚗 *${current.description}*\n` +
             `📋 ${current.identifier}\n` +
             `📏 Último valor: ${current.current.toLocaleString('pt-PT')} ${current.unit}\n\n` +
             `Por favor indique o valor atual de *${current.unit}*:`;

  await sock.sendMessage(from, { text: message });
}

async function finishConversation(sock, from, state) {
  console.log('💾 Guardando todos os valores...');

  let successCount = 0;
  let errorCount = 0;
  const results = [];

  // Guardar cada resposta na tabela correta
  for (const response of state.responses) {
    const { equipment, value } = response;

    try {
      let result;

      if (equipment.type === 'vehicle') {
        result = await supabase
          .from('vehicles')
          .update({
            km_atual: value,
            updated_at: new Date().toISOString()
          })
          .eq('id', equipment.id);
      } else if (equipment.type === 'truck') {
        result = await supabase
          .from('trucks')
          .update({
            km_atual: value,
            updated_at: new Date().toISOString()
          })
          .eq('id', equipment.id);
      } else if (equipment.type === 'machine') {
        result = await supabase
          .from('machines')
          .update({
            horas_atual: value,
            updated_at: new Date().toISOString()
          })
          .eq('id', equipment.id);
      }

      if (result.error) {
        console.error(`❌ Erro ao atualizar ${equipment.identifier}:`, result.error);
        errorCount++;
        results.push({
          equipment,
          value,
          success: false
        });
      } else {
        console.log(`✅ ${equipment.identifier}: ${value} ${equipment.unit}`);
        successCount++;
        results.push({
          equipment,
          value,
          success: true
        });
      }
    } catch (error) {
      console.error(`❌ Erro ao processar ${equipment.identifier}:`, error);
      errorCount++;
      results.push({
        equipment,
        value,
        success: false
      });
    }
  }

  // Construir mensagem de resumo
  let message = `✅ *Registo concluído!*\n\n` +
                `📊 Resumo:\n` +
                `━━━━━━━━━━━━━━━━\n\n`;

  results.forEach((r, index) => {
    const icon = r.success ? '✅' : '❌';
    message += `${icon} ${r.equipment.description}\n` +
               `   ${r.equipment.identifier}: *${r.value.toLocaleString('pt-PT')} ${r.equipment.unit}*\n\n`;
  });

  message += `━━━━━━━━━━━━━━━━\n` +
             `📅 ${new Date().toLocaleString('pt-PT')}\n\n`;

  if (errorCount > 0) {
    message += `⚠️ ${errorCount} erro(s) ao guardar.\n` +
               `Por favor contacte o suporte.`;
  } else {
    message += `🎉 Obrigado, *${state.userName}*!`;
  }

  await sock.sendMessage(from, { text: message });

  // Limpar estado
  conversationState.delete(from);
}

// ===== AGENDAMENTO SEMANAL =====

function getNextSendDate() {
  const now = new Date();
  const currentDay = now.getDay();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  let daysUntilSend;

  if (currentDay < CONFIG.sendDay) {
    daysUntilSend = CONFIG.sendDay - currentDay;
  } else if (currentDay === CONFIG.sendDay) {
    if (
      currentHour < CONFIG.sendHour ||
      (currentHour === CONFIG.sendHour && currentMinute < CONFIG.sendMinute)
    ) {
      daysUntilSend = 0;
    } else {
      daysUntilSend = 7;
    }
  } else {
    daysUntilSend = 7 - (currentDay - CONFIG.sendDay);
  }

  const nextDate = new Date(now);
  nextDate.setDate(now.getDate() + daysUntilSend);
  nextDate.setHours(CONFIG.sendHour, CONFIG.sendMinute, 0, 0);

  return nextDate;
}

function scheduleWeeklyMessages(sock) {
  function scheduleNext() {
    const nextSend = getNextSendDate();
    const delay = nextSend - new Date();

    console.log(
      `📅 Próximo envio agendado para: ${nextSend.toLocaleString('pt-PT')}`
    );
    console.log(`⏳ Faltam ${Math.round(delay / 1000 / 60 / 60)} horas`);

    setTimeout(async () => {
      await sendWeeklyMessages(sock);
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

async function sendWeeklyMessages(sock) {
  console.log('📨 Iniciando envio semanal...');

  try {
    // Buscar todos os colaboradores ativos com telefone
    const { data: users, error } = await supabase
      .from('users')
      .select('nome, telefone')
      .eq('ativo', true)
      .not('telefone', 'is', null);

    if (error) {
      console.error('❌ Erro ao buscar colaboradores:', error);
      return;
    }

    if (!users || users.length === 0) {
      console.log('⚠️ Nenhum colaborador encontrado');
      return;
    }

    console.log(`👥 Encontrados ${users.length} colaboradores`);

    // Enviar para cada colaborador que tenha equipamento
    for (const user of users) {
      try {
        const number = `${user.telefone}@s.whatsapp.net`;

        // Verificar se tem equipamento atribuído
        const data = await getUserEquipment(number);

        if (!data || !data.equipment || data.equipment.length === 0) {
          console.log(`⏭️ ${user.nome} não tem equipamentos atribuídos`);
          continue;
        }

        await sock.sendMessage(number, {
          text: `🚗 Olá *${user.nome}*!\n\n` +
                `Está na altura de registar os valores dos equipamentos.\n\n` +
                `Responda a esta mensagem com qualquer texto para começar.`
        });

        console.log(`✅ Mensagem enviada para ${user.nome} (${user.telefone})`);

        // Delay entre mensagens
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.error(`❌ Erro ao enviar para ${user.nome}:`, error);
      }
    }

    console.log('✅ Envio semanal concluído!');
  } catch (error) {
    console.error('❌ Erro geral no envio semanal:', error);
  }
}

// ===== INICIAR BOT =====

startBot().catch(error => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});
