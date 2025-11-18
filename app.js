// ============= 設定 =============
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxKVr9yY2VIUxBvqnrovrUA-l5ughmDVHD3E5o911DBK-fMEt1Tcxh9GJLJF0jlxTw/exec';
let currentTeam = '';
let currentKey = '';
let userName = '';
let pollingInterval = null;

// 返信機能用のグローバル変数
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
  cancelReply();
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
    
    const isFirstLoad = document.getElementById('messages-list').children.length === 0;
    
    displayMessages(messages);
    
    // 初回表示時は必ず最下部へスクロール
    if (isFirstLoad) {
      setTimeout(() => {
        scrollToBottom(true);
      }, 300); // 少し遅延させて確実にスクロール
    }
  } catch (error) {
    console.error('メッセージ取得エラー:', error);
  }
}

// ============= メッセージ表示（LINE式：古い順） =============
function displayMessages(messages) {
  const container = document.getElementById('messages-list');
  
  // スクロール位置を保存（ユーザーが読んでいる途中の場合）
  const wasAtBottom = isScrolledToBottom();
  
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
  
  // 時系列順にソート（古い順）★ここが重要
  messages.sort((a, b) => {
    const dateA = new Date(a.timestamp);
    const dateB = new Date(b.timestamp);
    return dateA - dateB; // 古い順
  });
  
  // ルートメッセージ（返信でないもの）を取得
  const rootMessages = messages.filter(msg => !msg.reply_to);
  
  // ★ルートメッセージも古い順にソート
  rootMessages.sort((a, b) => {
    const dateA = new Date(a.timestamp);
    const dateB = new Date(b.timestamp);
    return dateA - dateB; // 古い順
  });
  
  // 各ルートメッセージとそのスレッドを表示
  rootMessages.forEach(rootMsg => {
    // ルートメッセージを表示
    container.appendChild(createMessageElement(rootMsg, messageMap, false));
    
    // このメッセージへのすべての返信を取得
    const threadMessages = getThreadMessages(rootMsg.id, messages, messageMap);
    
    // 返信を時系列順に表示
    threadMessages.forEach(msg => {
      container.appendChild(createMessageElement(msg, messageMap, true));
    });
  });
  
  // 最下部にいた場合のみ自動スクロール
  if (wasAtBottom) {
    scrollToBottom();
  }
}

// ============= スクロール位置の判定 =============
function isScrolledToBottom() {
  const container = document.getElementById('messages-list');
  if (!container || container.children.length === 0) return true;
  
  const threshold = 100; // 100px以内なら「最下部」と判定
  return container.scrollHeight - container.clientHeight <= container.scrollTop + threshold;
}

// ============= 最下部へスクロール =============
function scrollToBottom(force = false) {
  const container = document.getElementById('messages-list');
  if (!container) return;
  
  // 強制スクロール（初回表示時など）
  if (force) {
    container.scrollTop = container.scrollHeight;
    return;
  }
  
  // 通常のスクロール（少し遅延）
  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 100);
}

// ============= スレッドのすべてのメッセージを取得 =============
function getThreadMessages(rootId, allMessages, messageMap) {
  const threadMessages = [];
  const visited = new Set();
  
  function collectReplies(messageId) {
    if (visited.has(messageId)) return;
    visited.add(messageId);
    
    const replies = allMessages.filter(msg => msg.reply_to === messageId);
    replies.forEach(reply => {
      threadMessages.push(reply);
      collectReplies(reply.id);
    });
  }
  
  collectReplies(rootId);
  
  // 時系列順にソート（古い順）
  threadMessages.sort((a, b) => {
    const dateA = new Date(a.timestamp);
    const dateB = new Date(b.timestamp);
    return dateA - dateB;
  });
  
  return threadMessages;
}

// ============= メッセージ要素作成 =============
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
  
  // 返信ボタンの表示制御（返信メッセージには表示しない）
  const replyButton = !isReply 
    ? `<button class="reply-btn" onclick="setReplyTo('${msg.id}', '${escapeHtml(msg.name)}', '${escapeHtml(msg.message).replace(/'/g, "\\'")}')">返信</button>` 
    : '';
  
  messageDiv.innerHTML = `
    <div class="message-header">
      <div class="message-info">
        <span class="message-name">${escapeHtml(msg.name)}</span>
        <span class="message-time">${msg.timestamp}</span>
      </div>
    </div>
    ${replyQuote}
    <div class="message-text">${escapeHtml(msg.message)}</div>
    <div class="message-actions">
      ${replyButton}
      <button class="read-btn" onclick="markAsRead('${msg.id}')">既読</button>
      <button class="delete-btn" onclick="deleteMessage('${msg.id}')">削除</button>
    </div>
    ${readersText}
  `;
  
  return messageDiv;
}

// ============= 返信機能 =============
function setReplyTo(messageId, name, message) {
  replyToId = messageId;
  replyToMessage = { name, message };
  
  const preview = document.getElementById('reply-preview');
  const content = document.getElementById('reply-content');
  
  const shortMsg = message.length > 100 ? message.substring(0, 100) + '...' : message;
  content.innerHTML = `<strong>${escapeHtml(name)}:</strong> ${escapeHtml(shortMsg)}`;
  preview.style.display = 'block';
  
  document.getElementById('message-text').focus();
  
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

// ============= メッセージ投稿 =============
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
      reply_to: replyToId || ''
    });
    
    if (result.status === 'ok') {
      document.getElementById('message-text').value = '';
      cancelReply();
      await loadMessages();
      
      // 投稿後は必ず最下部へスクロール（強制）
      setTimeout(() => {
        scrollToBottom(true);
      }, 300);
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
  }, 2000);
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