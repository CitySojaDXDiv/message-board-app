// ============= 設定 =============
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzWmwrxr-GKoZ2QxHTsWZbdOfFgF08xaqrvndbK7gDYOb8TRql8HqPoOZEHWe5ShWM/exec'; // ★ここにGASのURLを貼り付け
let currentTeam = '';
let currentKey = '';
let userName = '';
let pollingInterval = null;

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
}

// ============= チーム管理 =============
async function loadTeams() {
  try {
    const response = await fetch(`${GAS_URL}?action=get_teams`);
    const teams = await response.json();
    
    const select = document.getElementById('team-select');
    select.innerHTML = '<option value="">-- チームを選択 --</option>';
    
    teams.forEach(team => {
      const option = document.createElement('option');
      option.value = team.name;
      option.textContent = team.name + (team.is_protected ? ' 🔒' : '');
      select.appendChild(option);
    });
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
  
  // チームが保護されているかチェック
  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'check_team_auth',
        team: teamName
      })
    });
    
    const result = await response.json();
    
    if (result.is_protected) {
      // キー入力画面を表示
      document.getElementById('team-selection').style.display = 'none';
      document.getElementById('key-input').style.display = 'block';
    } else {
      // 直接メッセージエリアへ
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
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'verify_team_access',
        team: currentTeam,
        key: key
      })
    });
    
    const result = await response.json();
    
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
  document.getElementById('message-area').style.display = 'none';
  document.getElementById('team-selection').style.display = 'block';
  document.getElementById('messages-list').innerHTML = '';
}

async function createTeam() {
  const teamName = prompt('新しいチーム名を入力してください:');
  if (!teamName) return;
  
  const teamKey = prompt('チームキーを設定しますか？（空白=保護なし）:');
  
  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_team',
        team_name: teamName,
        team_key: teamKey || ''
      })
    });
    
    const result = await response.json();
    
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
    const url = `${GAS_URL}?action=get_messages&team=${encodeURIComponent(currentTeam)}&key=${encodeURIComponent(currentKey)}`;
    const response = await fetch(url);
    const messages = await response.json();
    
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

function displayMessages(messages) {
  const container = document.getElementById('messages-list');
  container.innerHTML = '';
  
  messages.forEach((msg, index) => {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    messageDiv.innerHTML = `
      <div class="message-header">
        <span class="message-name">${escapeHtml(msg.name)}</span>
        <span class="message-time">${msg.timestamp}</span>
      </div>
      <div class="message-text">${escapeHtml(msg.message)}</div>
      <div class="message-actions">
        <button class="delete-btn" onclick="deleteMessage('${msg.id}')">削除</button>
        <button class="read-btn" onclick="markAsRead('${msg.id}')">既読</button>
      </div>
      ${msg.readers.length > 0 ? `<div class="readers">既読: ${msg.readers.join(', ')}</div>` : ''}
    `;
    
    container.appendChild(messageDiv);
  });
}

async function postMessage() {
  userName = document.getElementById('user-name').value.trim();
  const messageText = document.getElementById('message-text').value.trim();
  
  if (!userName || !messageText) {
    alert('名前とメッセージを入力してください');
    return;
  }
  
  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'post_message',
        team: currentTeam,
        name: userName,
        message: messageText,
        key: currentKey
      })
    });
    
    const result = await response.json();
    
    if (result.status === 'ok') {
      document.getElementById('message-text').value = '';
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
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete_message',
        message_id: messageId,
        team: currentTeam,
        key: currentKey
      })
    });
    
    const result = await response.json();
    
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
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'mark_as_read',
        message_id: messageId,
        reader_name: userName,
        team: currentTeam,
        key: currentKey
      })
    });
    
    const result = await response.json();
    
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
  }, 5000); // 5秒ごと
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