// ============= 設定 =============
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxKVr9yY2VIUxBvqnrovrUA-l5ughmDVHD3E5o911DBK-fMEt1Tcxh9GJLJF0jlxTw/exec';
let currentTeam = '';
let currentKey = '';
let userName = '';
let pollingInterval = null;

// 返信機能用のグローバル変数
let replyToId = null;
let replyToMessage = null;
let replyToSegment = null; // ★追加：返信先のセグメント

// セグメント機能用のグローバル変数
let currentSegment = 'ALL';
let segments = [];

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
  
  // セグメント関連のイベントリスナー
  document.getElementById('segment-filter').addEventListener('change', onSegmentFilterChange);
  document.getElementById('manage-segments-btn').addEventListener('click', openSegmentModal);
  document.getElementById('close-segment-modal').addEventListener('click', closeSegmentModal);
  document.getElementById('create-segment-btn').addEventListener('click', createSegment);
　document.getElementById('manage-team-btn').addEventListener('click', openTeamModal);
　document.getElementById('close-team-modal').addEventListener('click', closeTeamModal);
　document.getElementById('edit-team-name-btn').addEventListener('click', editTeamName);
　document.getElementById('edit-team-key-btn').addEventListener('click', editTeamKey);
　document.getElementById('delete-team-btn').addEventListener('click', deleteTeam);
　
　// ★ファイル関連のイベントリスナーを追加
  document.getElementById('file-input').addEventListener('change', onFileSelected);
  document.getElementById('clear-file-btn').addEventListener('click', clearFile);
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

async function showMessageArea() {
  document.getElementById('team-selection').style.display = 'none';
  document.getElementById('key-input').style.display = 'none';
  document.getElementById('message-area').style.display = 'block';
  document.getElementById('current-team-name').textContent = `チーム: ${currentTeam}`;
  
  // セグメント一覧を読み込み
  await loadSegments();
  
  loadMessages();
  startPolling();
}

function leaveTeam() {
  stopPolling();
  currentTeam = '';
  currentKey = '';
  currentSegment = 'ALL';
  segments = [];
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

// ============= セグメント管理 =============

/**
 * セグメント一覧を読み込み
 */
async function loadSegments() {
  try {
    const result = await jsonpRequest(GAS_URL, {
      action: 'get_segments',
      team: currentTeam
    });
    
    if (Array.isArray(result)) {
      segments = result;
      updateSegmentUI();
    }
  } catch (error) {
    console.error('セグメント取得エラー:', error);
  }
}

/**
 * セグメントUIを更新
 */
function updateSegmentUI() {
  // フィルタードロップダウンを更新
  const filterSelect = document.getElementById('segment-filter');
  filterSelect.innerHTML = '<option value="ALL">ALL（すべて表示）</option>';
  
  segments.forEach(seg => {
    if (seg.name !== 'ALL') {
      const option = document.createElement('option');
      option.value = seg.name;
      option.textContent = seg.name;
      filterSelect.appendChild(option);
    }
  });
  
  // 投稿フォームのセグメント選択を更新
  const postSelect = document.getElementById('segment-select');
  postSelect.innerHTML = '<option value="ALL">ALL</option>';
  
  segments.forEach(seg => {
    if (seg.name !== 'ALL') {
      const option = document.createElement('option');
      option.value = seg.name;
      option.textContent = seg.name;
      postSelect.appendChild(option);
    }
  });
}

/**
 * セグメントフィルター変更時（★改善：投稿セグメントも連動）
 */
function onSegmentFilterChange() {
  currentSegment = document.getElementById('segment-filter').value;
  
  // ★返信中でない場合のみ、投稿セグメントも連動
  if (!replyToId) {
    document.getElementById('segment-select').value = currentSegment;
  }
  
  loadMessages();
}

/**
 * セグメント管理モーダルを開く
 */
function openSegmentModal() {
  updateSegmentList();
  document.getElementById('segment-modal').style.display = 'flex';
}

/**
 * セグメント管理モーダルを閉じる
 */
function closeSegmentModal() {
  document.getElementById('segment-modal').style.display = 'none';
  document.getElementById('new-segment-name').value = '';
}

/**
 * セグメント一覧を表示
 */
function updateSegmentList() {
  const listContainer = document.getElementById('segment-list-items');
  listContainer.innerHTML = '';
  
  if (segments.length === 0) {
    listContainer.innerHTML = '<li>セグメントがありません</li>';
    return;
  }
  
  segments.forEach(seg => {
    const li = document.createElement('li');
    li.className = 'segment-item';
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = seg.name;
    nameSpan.className = 'segment-name';
    
    li.appendChild(nameSpan);
    
    // ALLセグメントは削除不可
    if (seg.name !== 'ALL') {
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '削除';
      deleteBtn.className = 'delete-segment-btn';
      deleteBtn.onclick = () => deleteSegment(seg.name);
      li.appendChild(deleteBtn);
    }
    
    listContainer.appendChild(li);
  });
}

/**
 * セグメントを作成
 */
async function createSegment() {
  const segmentName = document.getElementById('new-segment-name').value.trim();
  
  if (!segmentName) {
    alert('セグメント名を入力してください');
    return;
  }
  
  try {
    const result = await jsonpPost(GAS_URL, {
      action: 'create_segment',
      team: currentTeam,
      segment_name: segmentName,
      key: currentKey
    });
    
    if (result.status === 'ok') {
      alert('セグメントを作成しました！');
      document.getElementById('new-segment-name').value = '';
      await loadSegments();
      updateSegmentList();
    } else {
      alert('エラー: ' + result.message);
    }
  } catch (error) {
    alert('セグメント作成に失敗しました: ' + error);
  }
}

/**
 * セグメントを削除
 */
async function deleteSegment(segmentName) {
  const confirmed = confirm(
    `セグメント「${segmentName}」を削除しますか？\n\nこのセグメントのメッセージもすべて削除されます。`
  );
  
  if (!confirmed) return;
  
  try {
    const result = await jsonpPost(GAS_URL, {
      action: 'delete_segment',
      team: currentTeam,
      segment_name: segmentName,
      key: currentKey
    });
    
    if (result.status === 'ok') {
      alert('セグメントを削除しました');
      
      // 現在のフィルターが削除されたセグメントの場合、ALLに戻す
      if (currentSegment === segmentName) {
        currentSegment = 'ALL';
        document.getElementById('segment-filter').value = 'ALL';
        document.getElementById('segment-select').value = 'ALL';
      }
      
      await loadSegments();
      updateSegmentList();
      loadMessages();
    } else {
      alert('エラー: ' + result.message);
    }
  } catch (error) {
    alert('セグメント削除に失敗しました: ' + error);
  }
}

// ============= メッセージ管理 =============
async function loadMessages() {
  try {
    const messages = await jsonpRequest(GAS_URL, {
      action: 'get_messages',
      team: currentTeam,
      key: currentKey,
      segment: currentSegment
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
      }, 300);
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
  
  // 時系列順にソート（古い順）
  messages.sort((a, b) => {
    const dateA = new Date(a.timestamp);
    const dateB = new Date(b.timestamp);
    return dateA - dateB;
  });
  
  // ルートメッセージ（返信でないもの）を取得
  const rootMessages = messages.filter(msg => !msg.reply_to);
  
  // ルートメッセージも古い順にソート
  rootMessages.sort((a, b) => {
    const dateA = new Date(a.timestamp);
    const dateB = new Date(b.timestamp);
    return dateA - dateB;
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
  
  const threshold = 100;
  return container.scrollHeight - container.clientHeight <= container.scrollTop + threshold;
}

// ============= 最下部へスクロール =============
function scrollToBottom(force = true) {
  const container = document.getElementById('messages-list');
  if (!container) {
    console.error('❌ messages-list が見つかりません');
    return;
  }
  
  if (force) {
    container.scrollTop = container.scrollHeight;
    return;
  }
  
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
  
  // セグメントバッジ
  const segmentBadge = msg.segment && msg.segment !== 'ALL' 
    ? `<span class="segment-badge">${escapeHtml(msg.segment)}</span>` 
    : '';
  
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
  
  // ★ファイル表示（画像サムネイルを非表示）
  let fileDisplay = '';
  if (msg.file_url && msg.file_name) {
    const isImage = msg.file_type && msg.file_type.startsWith('image/');
    
    // 画像もその他のファイルも同じようにリンク表示
    const fileIcon = isImage ? '🖼️' : '📎';
    
    fileDisplay = `
      <div class="file-attachment">
        <a href="${msg.file_url}" target="_blank" class="file-link">
          ${fileIcon} ${escapeHtml(msg.file_name)}
        </a>
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
    ? `<button class="reply-btn" onclick="setReplyTo('${msg.id}', '${escapeHtml(msg.name)}', '${escapeHtml(msg.message).replace(/'/g, "\\'")}', '${msg.segment || 'ALL'}')">返信</button>` 
    : '';
  
  messageDiv.innerHTML = `
    <div class="message-header">
      <div class="message-info">
        <span class="message-name">${escapeHtml(msg.name)}</span>
        ${segmentBadge}
        <span class="message-time">${formatTimestamp(msg.timestamp)}</span>
      </div>
    </div>
    ${replyQuote}
    <div class="message-text">${escapeHtml(msg.message)}</div>
    ${fileDisplay}
    <div class="message-actions">
      ${replyButton}
      <button class="read-btn" onclick="markAsRead('${msg.id}')">既読</button>
      <button class="delete-btn" onclick="deleteMessage('${msg.id}')">削除</button>
    </div>
    ${readersText}
  `;
  
  return messageDiv;
}

// ============= 返信機能（★改善：セグメント固定） =============
function setReplyTo(messageId, name, message, segment) {
  replyToId = messageId;
  replyToMessage = { name, message };
  replyToSegment = segment || 'ALL'; // ★追加：返信先のセグメントを保存
  
  const preview = document.getElementById('reply-preview');
  const content = document.getElementById('reply-content');
  
  const shortMsg = message.length > 100 ? message.substring(0, 100) + '...' : message;
  content.innerHTML = `<strong>${escapeHtml(name)}:</strong> ${escapeHtml(shortMsg)}`;
  preview.style.display = 'block';
  
  // ★投稿セグメントを返信先と同じに固定
  const segmentSelect = document.getElementById('segment-select');
  segmentSelect.value = replyToSegment;
  segmentSelect.disabled = true; // ★変更不可にする
  
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
  replyToSegment = null; // ★追加
  
  // ★セグメント選択を有効化
  const segmentSelect = document.getElementById('segment-select');
  segmentSelect.disabled = false;
  
  // ★現在のフィルターに合わせる
  segmentSelect.value = currentSegment;
  
  document.getElementById('reply-preview').style.display = 'none';
}

// ============= メッセージ投稿 =============
async function postMessage() {
  userName = document.getElementById('user-name').value.trim();
  const messageText = document.getElementById('message-text').value.trim();
  const selectedSegment = document.getElementById('segment-select').value;
  
  if (!userName || !messageText) {
    alert('名前とメッセージを入力してください');
    return;
  }
  
  try {
    let result;
    
    // ★ファイルがある場合（POST方式）
    if (selectedFile) {
      const fileData = await fileToBase64(selectedFile);
      
      console.log('ファイルアップロード開始:', selectedFile.name);
      
      // ★fetch APIを使用してPOSTリクエスト
      const response = await fetch(GAS_URL, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'upload_file',
          team: currentTeam,
          name: userName,
          message: messageText,
          key: currentKey,
          reply_to: replyToId || '',
          segment: selectedSegment,
          file_data: fileData,
          file_name: selectedFile.name,
          file_type: selectedFile.type
        })
      });
      
      if (!response.ok) {
        throw new Error('ファイルのアップロードに失敗しました');
      }
      
      result = await response.json();
      console.log('ファイルアップロード完了:', result);
      
      clearFile();
      
    } else {
      // ファイルがない場合は通常投稿（JSONP）
      result = await jsonpPost(GAS_URL, {
        action: 'post_message',
        team: currentTeam,
        name: userName,
        message: messageText,
        key: currentKey,
        reply_to: replyToId || '',
        segment: selectedSegment
      });
    }
    
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
    console.error('投稿エラー:', error);
    alert('投稿に失敗しました: ' + error.message);
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


// ============= 時刻フォーマット関数（追加） =============
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  
  // 月/日(曜日) 時:分 の形式にフォーマット
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getDay()];
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  
  return `${month}/${day}(${weekday}) ${hours}:${minutes}`;
}

// ============= ファイル添付機能 =============

let selectedFile = null;

/**
 * ファイル選択時の処理
 */
function onFileSelected(event) {
  const file = event.target.files[0];
  
  if (!file) {
    clearFile();
    return;
  }
  
  // ★ファイルサイズチェック（10MBに設定）
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    alert('ファイルサイズは10MB以下にしてください');
    clearFile();
    return;
  }
  
  selectedFile = file;
  
  // ファイル名を表示
  document.getElementById('file-name-display').textContent = file.name;
  document.getElementById('clear-file-btn').style.display = 'inline-block';
}

/**
 * ファイル選択をクリア
 */
function clearFile() {
  selectedFile = null;
  document.getElementById('file-input').value = '';
  document.getElementById('file-name-display').textContent = '';
  document.getElementById('clear-file-btn').style.display = 'none';
}

/**
 * ファイルをBase64にエンコード
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============= チーム管理機能 =============

/**
 * チーム管理モーダルを開く
 */
function openTeamModal() {
  document.getElementById('team-info-name').textContent = currentTeam;
  
  // 保護状態を確認
  jsonpRequest(GAS_URL, {
    action: 'check_team_auth',
    team: currentTeam
  }).then(result => {
    const protectedText = result.is_protected ? '🔒 保護されています' : '🔓 保護されていません';
    document.getElementById('team-info-protected').textContent = protectedText;
  });
  
  document.getElementById('team-modal').style.display = 'flex';
}

/**
 * チーム管理モーダルを閉じる
 */
function closeTeamModal() {
  document.getElementById('team-modal').style.display = 'none';
  document.getElementById('new-team-name').value = '';
  document.getElementById('new-team-key').value = '';
}

/**
 * チーム名を変更
 */
async function editTeamName() {
  const newTeamName = document.getElementById('new-team-name').value.trim();
  
  if (!newTeamName) {
    alert('新しいチーム名を入力してください');
    return;
  }
  
  if (!confirm(`チーム名を「${newTeamName}」に変更しますか？`)) {
    return;
  }
  
  try {
    const result = await jsonpPost(GAS_URL, {
      action: 'edit_team_name',
      old_team_name: currentTeam,
      new_team_name: newTeamName,
      key: currentKey
    });
    
    if (result.status === 'ok') {
      alert('チーム名を変更しました！');
      currentTeam = newTeamName;
      document.getElementById('current-team-name').textContent = `チーム: ${currentTeam}`;
      document.getElementById('new-team-name').value = '';
      closeTeamModal();
      loadTeams();
    } else {
      alert('エラー: ' + result.message);
    }
  } catch (error) {
    alert('チーム名の変更に失敗しました: ' + error);
  }
}

/**
 * チームキーを変更
 */
async function editTeamKey() {
  const newTeamKey = document.getElementById('new-team-key').value;
  
  const message = newTeamKey 
    ? `チームキーを変更しますか？\n\n新しいキー: ${newTeamKey}` 
    : 'チームの保護を解除しますか？';
  
  if (!confirm(message)) {
    return;
  }
  
  try {
    const result = await jsonpPost(GAS_URL, {
      action: 'edit_team_key',
      team_name: currentTeam,
      new_team_key: newTeamKey,
      key: currentKey
    });
    
    if (result.status === 'ok') {
      alert('チームキーを変更しました！');
      currentKey = newTeamKey;
      document.getElementById('new-team-key').value = '';
      closeTeamModal();
      loadTeams();
    } else {
      alert('エラー: ' + result.message);
    }
  } catch (error) {
    alert('チームキーの変更に失敗しました: ' + error);
  }
}

/**
 * チームを削除
 */
async function deleteTeam() {
  const confirmed = confirm(
    `チーム「${currentTeam}」を削除しますか？\n\n⚠️ すべてのメッセージとセグメントも削除されます。\n\nこの操作は取り消せません。`
  );
  
  if (!confirmed) return;
  
  // 二重確認
  const doubleConfirmed = confirm(
    `本当に削除しますか？\n\nチーム名: ${currentTeam}\n\nもう一度確認してください。`
  );
  
  if (!doubleConfirmed) return;
  
  try {
    const result = await jsonpPost(GAS_URL, {
      action: 'delete_team',
      team_name: currentTeam,
      key: currentKey
    });
    
    if (result.status === 'ok') {
      alert('チームを削除しました');
      closeTeamModal();
      leaveTeam();
      loadTeams();
    } else {
      alert('エラー: ' + result.message);
    }
  } catch (error) {
    alert('チーム削除に失敗しました: ' + error);
  }
}