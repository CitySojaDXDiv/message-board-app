// ============= 設定 =============
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxKVr9yY2VIUxBvqnrovrUA-l5ughmDVHD3E5o911DBK-fMEt1Tcxh9GJLJF0jlxTw/exec'; // ★GASのURL
let currentTeam = '';
let currentKey = '';
let userName = '';
let pollingInterval = null;

// 返信機能用のグローバル変数（新規追加）
let replyToId = null;
let replyToMessage = null;

// ============= JSONP用ヘルパー関数 =============
function jsonpRequest(url, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_callback_' + Math.random().toString(36).substring(7);
    
    window[callbackName] = function(data) {
      delete window[callbackName];
      document.body.removeChild(script);
      resolve(data);
    };
    
    const script = document.createElement('script');
    const queryParams = new URLSearchParams({...params, callback: callbackName});
    script.src = `${url}?${queryParams}`;
    script.onerror = () => {
      delete window[callbackName];
      document.body.removeChild(script);
      reject(new Error('JSONP request failed'));
    };
    
    document.body.appendChild(script);
  });
}

function jsonpPost(url, data) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_callback_' + Math.random().toString(36).substring(7);
    
    window[callbackName] = function(response) {
      delete window[callbackName];
      document.body.removeChild(script);
      resolve(response);
    };
    
    const script = document.createElement('script');
    const params = new URLSearchParams({
      ...data,
      callback: callbackName
    });
    script.src = `${url}?${params}`;
    script.onerror = () => {
      delete window[callbackName];
      document.body.removeChild(script);
      reject(new Error('JSONP request failed'));
    };
    
    document.body.appendChild(script);
  });
}

// ============= 初期化 =============
document.addEventListener('DOMContentLoaded', () => {
  loadTeams();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('join-team-btn').addEventListener('click', joinTeam);
  document.getElementById('create-team-btn').addEventListener('click', createTeam);
  document.getElementById('verify-key-btn').addEventListener('click', verifyKey);
  document.getElementById('post-btn').addEventListener('click', postMessage);
  document.getElementById('leave-team-btn').addEventListener('click', leaveTeam);
  
  // 返信キャンセルボタン（新規追加）
  document.getElementById('cancel-reply').addEventListener('click', cancelReply);
}

// ============= チーム管理 =============
async function loadTeams() {
  try {
    const teams = await jsonpRequest(GAS_URL, { action: 'get_teams' });
    
    const select = document.getElementById('team-select');
    select.innerHTML = '<option value="">-- チームを選択 --</option>';
    
    if (Array.isArray(teams)) {
      teams.forEach(team => {
        const option = document.createElement('option');
        option.value = team.name;
        option.textContent = team.name + (team.is_protected ? ' 🔒' : '');
        select.appendChild(option);
      });
    }
  } catch (error) {
    alert('チーム一覧の取得に失敗しました: ' + error);
  }
}

async function joinTeam() {
  const teamName = document.getElementById('team-select').value;
  if (!teamName) {
    alert('チームを選択してください');
    return;
  }
  
  currentTeam = teamName;
  
  try {
    const result = await jsonpPost(GAS_URL, {
      action: 'check_team_auth',
      team: teamName
    });
    
    if (result.is_protected) {
      document.getElementById('team-selection').style.display = 'none';
      document.getElementById('key-input').style.display = 'block';
    } else {
      showMessageArea();
    }
  } catch (error) {
    alert('エラーが発生しました: ' + error);
  }
}

async function verifyKey() {
  const key = document.getElementById('team-key').value;
  
  if (!key) {
    alert('キーを入力してください');
    return;
  }
  
  try {
    const result = await jsonpPost(GAS_URL, {
      action: 'verify_team_access',
      team: currentTeam,
      key: key
    });
    
    if (result.authorized) {
      currentKey = key;
      showMessageArea();
    } else {
      alert('キーが正しくありません');
    }
  } catch (error) {
    alert('認証エラー: ' + error);
  }
}

function showMessageArea() {
  document.getElementById('team-selection').style.display = 'none';
  document.getElementById('key-input').style.display = 'none';
  document.getElementById('message-area').style.display = 'block';
  document.getElementById('current-team-name').textContent = `チーム: ${currentTeam}`;
  
  loadMessages();
  startPolling();
}

function leaveTeam() {
  stopPolling();
  currentTeam = '';
  currentKey = '';
  cancelReply(); // 返信状態をリセット
  document.getElementById('message-area').style.display = 'none';
  document.getElementById('team-selection').style.display = 'block';
  document.getElementById('messages-list').innerHTML = '';
}

async function createTeam() {
  const teamName = prompt('新しいチーム名を入力してください:');
  if (!teamName) return;
  
  const teamKey = prompt('チームキーを設定しますか？（空白=保護なし）:');
  
  try {
    const result = await jsonpPost(GAS_URL, {
      action: 'create_team',
      team_name: teamName,
      team_key: teamKey || ''
    });
    
    if (result.status === 'ok') {
      alert('チームを作成しました！');
      loadTeams();
    } else {
      alert('エラー: ' + result.message);
    }
  } catch (error) {
    alert('チーム作成に失敗しました: ' + error);
  }
}

// ============= メッセージ管理 =============
async function loadMessages() {
  try {
    const messages = await jsonpRequest(GAS_URL, {
      action: 'get_messages',
      team: currentTeam,
      key: currentKey
    });
    
    if (messages.auth_required) {
      alert('認証が必要です');
      leaveTeam();
      return;
    }
    
    displayMessages(messages);
  } catch (error) {
    console.error('メッセージ取得エラー:', error);
  }
}

// ============= メッセージ表示（返信機能対応） =============
function displayMessages(messages) {
  const container = document.getElementById('messages-list');
  container.innerHTML = '';
  
  if (!Array.isArray(messages) || messages.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:#999; padding:20px;">メッセージがありません</p>';
    return;
  }
  
  // メッセージをIDでマッピング
  const messageMap = {};
  messages.forEach(msg => {
    messageMap[msg.id] = msg;
  });
  
  // ルートメッセージ（返信でないもの）と返信を分離
  const rootMessages = messages.filter(msg => !msg.reply_to);
  const replies = messages.filter(msg => msg.reply_to);
  
  // ルートメッセージを表示
  rootMessages.forEach(msg => {
    container.appendChild(createMessageElement(msg, messageMap, false));
    
    // このメッセージへの返信を表示
    const msgReplies = replies.filter(r => r.reply_to === msg.id);
    msgReplies.forEach(reply => {
      container.appendChild(createMessageElement(reply, messageMap, true));
    });
  });
}

// ============= メッセージ要素作成（返信対応） =============
function createMessageElement(msg, messageMap, isReply = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message' + (isReply ? ' reply' : '');
  messageDiv.id = 'msg-' + msg.id;
  
  // 返信先の引用表示
  let replyQuote = '';
  if (msg.reply_to && messageMap[msg.reply_to]) {
    const originalMsg = messageMap[msg.reply_to];
    const shortMsg = originalMsg.message.length > 50 
      ? originalMsg.message.substring(0, 50) + '...' 
      : originalMsg.message;
    replyQuote = `
      <div class="reply-to-quote">
        <strong>↩ ${escapeHtml(originalMsg.name)}:</strong> ${escapeHtml(shortMsg)}
      </div>
    `;
  }
  
  // 既読者リスト
  const readers = msg.readers || [];
  const readersText = readers.length > 0 
    ? `<div class="readers">既読: ${readers.join(', ')}</div>` 
    : '';
  
  messageDiv.innerHTML = `
    <div class="message-header">
      <span class="message-name">${escapeHtml(msg.name)}</span>
      <span class="message-time">${msg.timestamp}</span>
    </div>
    ${replyQuote}
    <div class="message-text">${escapeHtml(msg.message)}</div>
    <div class="message-actions">
      <button class="reply-btn" onclick="setReplyTo('${msg.id}', '${escapeHtml(msg.name)}', '${escapeHtml(msg.message).replace(/'/g, "\\'")}')">返信</button>
      <button class="read-btn" onclick="markAsRead('${msg.id}')">既読</button>
      <button class="delete-btn" onclick="deleteMessage('${msg.id}')">削除</button>
    </div>
    ${readersText}
  `;
  
  return messageDiv;
}

// ============= 返信機能（新規追加） =============
function setReplyTo(messageId, name, message) {
  replyToId = messageId;
  replyToMessage = { name, message };
  
  // 返信プレビューを表示
  const preview = document.getElementById('reply-preview');
  const content = document.getElementById('reply-content');
  
  const shortMsg = message.length > 100 ? message.substring(0, 100) + '...' : message;
  content.innerHTML = `<strong>${escapeHtml(name)}:</strong> ${escapeHtml(shortMsg)}`;
  preview.style.display = 'block';
  
  // メッセージ入力欄にフォーカス
  document.getElementById('message-text').focus();
  
  // 返信先メッセージまでスクロール
  const targetMsg = document.getElementById('msg-' + messageId);
  if (targetMsg) {
    targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetMsg.style.background = '#FFF9C4';
    setTimeout(() => {
      targetMsg.style.background = '';
    }, 2000);
  }
}

function cancelReply() {
  replyToId = null;
  replyToMessage = null;
  document.getElementById('reply-preview').style.display = 'none';
}

// ============= メッセージ投稿（返信対応） =============
async function postMessage() {
  userName = document.getElementById('user-name').value.trim();
  const messageText = document.getElementById('message-text').value.trim();
  
  if (!userName || !messageText) {
    alert('名前とメッセージを入力してください');
    return;
  }
  
  try {
    const result = await jsonpPost(GAS_URL, {
      action: 'post_message',
      team: currentTeam,
      name: userName,
      message: messageText,
      key: currentKey,
      reply_to: replyToId || '' // 返信先IDを追加
    });
    
    if (result.status === 'ok') {
      document.getElementById('message-text').value = '';
      cancelReply(); // 返信状態をリセット
      loadMessages();
    } else {
      alert('エラー: ' + result.message);
    }
  } catch (error) {
    alert('投稿に失敗しました: ' + error);
  }
}

async function deleteMessage(messageId) {
  if (!confirm('このメッセージを削除しますか？')) return;
  
  try {
    const result = await jsonpPost(GAS_URL, {
      action: 'delete_message',
      message_id: messageId,
      team: currentTeam,
      key: currentKey
    });
    
    if (result.status === 'ok') {
      loadMessages();
    } else {
      alert('エラー: ' + result.message);
    }
  } catch (error) {
    alert('削除に失敗しました: ' + error);
  }
}

async function markAsRead(messageId) {
  if (!userName) {
    userName = document.getElementById('user-name').value.trim();
    if (!userName) {
      alert('名前を入力してください');
      return;
    }
  }
  
  try {
    const result = await jsonpPost(GAS_URL, {
      action: 'mark_as_read',
      message_id: messageId,
      reader_name: userName,
      team: currentTeam,
      key: currentKey
    });
    
    if (result.status === 'ok') {
      loadMessages();
    } else {
      alert('エラー: ' + result.message);
    }
  } catch (error) {
    alert('既読マークに失敗しました: ' + error);
  }
}

// ============= ポーリング =============
function startPolling() {
  pollingInterval = setInterval(() => {
    loadMessages();
  }, 5000);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// ============= ユーティリティ =============
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}