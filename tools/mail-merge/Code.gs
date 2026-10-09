const CONFIG = {
  SENDER_NAME: '',
  FROM: '',
  REPLY_TO: '',
  DAILY_LIMIT: 450,
  TEST_ROWS: 3,
  ALLOW_BLANK: false,
  SKIP_INVALID_ROWS: false,
  SKIP_FILTERED_ROWS: true,
  STATUS_COLUMN: 'Email Sent',
};

const COLUMN_NAMES = {
  email: ['Email', 'Email Address', 'E-mail', 'To'],
  cc: ['CC'],
  bcc: ['BCC'],
  attachments: ['Attachments', 'Attachment'],
};
const PLACEHOLDER = /\{\{([^{}]+?)\}\}/g;
const ADDRESS = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/;
const MAX_RUN_MS = 5 * 60 * 1000;
const MAX_LISTED_PROBLEMS = 15;
const HOUR_MS = 60 * 60 * 1000;
const GMAIL_UPLOAD = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/';
const TURN_ON_API = 'In the Apps Script editor, click + next to "Services", choose "Gmail API" and click Add. Then try again.';

class UserError extends Error {
  constructor(title, message) {
    super(message);
    this.title = title;
  }
}

class RowError extends Error {}

class GmailApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Mail merge')
    .addItem('Choose template draft...', 'chooseTemplate')
    .addItem('Preview selected row', 'previewRow')
    .addSeparator()
    .addItem('Send test emails to me', 'sendTestEmails')
    .addItem('Create Gmail drafts', 'createDrafts')
    .addItem('Send emails', 'sendEmails')
    .addSeparator()
    .addItem('Check sending allowance', 'checkAllowance')
    .addToUi();
}

function sendEmails() {
  withErrors_(() => run_('send'));
}

function createDrafts() {
  withErrors_(() => run_('draft'));
}

function sendTestEmails() {
  withErrors_(() => run_('test'));
}

function chooseTemplate() {
  withErrors_(() => {
    const draft = pickDraft_();
    if (draft) {
      SpreadsheetApp.getActive().toast(draft.getMessage().getSubject(), 'Template set', 5);
    }
  });
}

function checkAllowance() {
  withErrors_(() => {
    const ui = SpreadsheetApp.getUi();
    const used = sentInLast24h_();
    ui.alert('Sending allowance',
      `This script has sent to ${used} recipient(s) in the last 24 hours. With DAILY_LIMIT at ` +
      `${CONFIG.DAILY_LIMIT}, it will send to ${Math.max(0, CONFIG.DAILY_LIMIT - used)} more before stopping.\n\n` +
      `Apps Script's separate mail quota shows ${MailApp.getRemainingDailyQuota()} remaining. Emails sent ` +
      'through the Gmail API should leave that number unchanged.',
      ui.ButtonSet.OK);
  });
}

function previewRow() {
  withErrors_(() => {
    const ui = SpreadsheetApp.getUi();
    const sheet = SpreadsheetApp.getActiveSheet();
    const draft = templateDraft_();
    if (!draft) return;
    const template = loadTemplate_(draft);
    const ctx = readSheet_(sheet);
    checkTemplate_(template, ctx);

    const active = sheet.getActiveRange();
    let r = active ? active.getRow() - 1 : 0;
    if (r < 1 || r >= ctx.values.length || isBlankRow_(ctx.values[r])) {
      r = pendingRows_(sheet, ctx, 'send')[0];
      if (r === undefined) {
        throw new UserError('Nothing to preview', 'Every row is either blank or already marked as sent.');
      }
    }
    let email;
    try {
      email = buildEmail_(r, ctx, template, {});
    } catch (e) {
      if (!(e instanceof RowError)) throw e;
      throw new UserError(`Row ${r + 1} has a problem`, e.message);
    }
    const page = HtmlService.createHtmlOutput(previewHtml_(email, template)).setWidth(760).setHeight(600);
    ui.showModalDialog(page, `Preview: row ${email.row}`);
  });
}

function withErrors_(fn) {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    const ui = SpreadsheetApp.getUi();
    ui.alert(e.title, e.message, ui.ButtonSet.OK);
  }
}

function run_(mode) {
  const started = Date.now();
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) {
    throw new UserError('Already running', 'A mail merge is already running in this spreadsheet. Wait for it to finish.');
  }
  try {
    const sheet = SpreadsheetApp.getActiveSheet();
    const draft = templateDraft_();
    if (!draft) return;
    const template = loadTemplate_(draft);
    const ctx = readSheet_(sheet);
    checkTemplate_(template, ctx);
    checkSender_();
    if (typeof Gmail === 'undefined') throw new UserError('Turn on the Gmail API', TURN_ON_API);

    const rows = pendingRows_(sheet, ctx, mode === 'test' ? 'send' : mode);
    const emails = [];
    const problems = [];
    const fileCache = {};
    const wanted = mode === 'test' ? rows.slice(0, CONFIG.TEST_ROWS) : rows;
    rows.forEach((r) => {
      try {
        emails.push(buildEmail_(r, ctx, template, wanted.indexOf(r) !== -1 ? fileCache : null));
      } catch (e) {
        if (!(e instanceof RowError)) throw e;
        problems.push(`Row ${r + 1}: ${e.message}`);
      }
    });

    if (mode !== 'test' && problems.length && !CONFIG.SKIP_INVALID_ROWS) {
      throw new UserError(
        `${problems.length} row(s) need fixing`,
        `Nothing was ${mode === 'draft' ? 'created' : 'sent'}.\n\n${listProblems_(problems)}\n\n` +
          'Fix those rows and run it again, or set SKIP_INVALID_ROWS to true in the script to leave them out.'
      );
    }

    let batch = mode === 'test' ? emails.filter((e) => wanted.indexOf(e.row - 1) !== -1) : emails;
    if (!batch.length) {
      const why = problems.length ? `\n\n${listProblems_(problems)}` : '';
      throw new UserError('Nothing to do', `There are no rows left to ${mode === 'draft' ? 'draft' : 'send'}. ` +
        `Rows marked "Sent" in the "${CONFIG.STATUS_COLUMN}" column are skipped; clear a cell to send that row again.${why}`);
    }

    const me = Session.getEffectiveUser().getEmail();
    if (mode === 'test') {
      batch = batch.map((e) => Object.assign({}, e, {
        subject: `[TEST for ${e.to.join(', ')}] ${e.subject}`,
        to: [me], cc: [], bcc: [],
      }));
    }

    const quota = mode === 'draft' ? Infinity : Math.max(0, CONFIG.DAILY_LIMIT - sentInLast24h_());
    if (quota < 1) {
      throw new UserError('Daily limit reached', `This script has sent to ${CONFIG.DAILY_LIMIT} recipients in the ` +
        'last 24 hours, which is its DAILY_LIMIT. Try again later.');
    }
    const needed = batch.reduce((n, e) => n + recipientCount_(e), 0);
    if (mode === 'send') {
      const from = CONFIG.FROM || me;
      let message = `Send ${batch.length} email(s) from ${from}\nto the rows on the "${sheet.getName()}" sheet,\n` +
        `using the draft "${template.subject}"?`;
      if (problems.length) message += `\n\n${problems.length} row(s) with problems will be skipped.`;
      if (needed > quota) {
        message += `\n\nDAILY_LIMIT allows ${quota} more recipient(s) in the next 24 hours, so this run stops ` +
          'there. Run it again later to send the rest.';
      }
      if (ui.alert('Send emails?', message, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
    }

    if (mode !== 'test') ensureStatusColumn_(sheet, ctx);
    const result = deliverAll_(batch, template, mode, sheet, ctx, quota, started);
    ui.alert(summaryTitle_(result), summaryText_(mode, result, problems, me), ui.ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

function deliverAll_(batch, template, mode, sheet, ctx, quota, started) {
  const result = { done: 0, failed: [], stoppedFor: '', left: 0, error: '' };
  for (let i = 0; i < batch.length; i++) {
    const email = batch[i];
    if (Date.now() - started > MAX_RUN_MS) {
      result.stoppedFor = 'time';
      result.left = batch.length - i;
      break;
    }
    const count = recipientCount_(email);
    if (mode !== 'draft' && count > quota) {
      result.stoppedFor = 'quota';
      result.left = batch.length - i;
      break;
    }
    try {
      deliver_(email, template, mode);
    } catch (e) {
      if (!(e instanceof GmailApiError)) throw e;
      if (isSetupError_(e)) throw new UserError('Turn on the Gmail API', `${e.message}\n\n${TURN_ON_API}`);
      if (isLimitError_(e)) {
        result.stoppedFor = 'gmail';
        result.left = batch.length - i;
        result.error = e.message;
        break;
      }
      result.failed.push(`Row ${email.row}: ${e.message}`);
      if (mode !== 'test') setStatus_(sheet, ctx, email.row, `Error: ${e.message}`);
      continue;
    }
    if (mode !== 'draft') {
      quota -= count;
      recordSends_(count);
    }
    result.done++;
    if (mode === 'test') continue;
    const mark = mode === 'draft' ? 'Draft' : 'Sent';
    try {
      setStatus_(sheet, ctx, email.row, `${mark} ${now_()}`);
    } catch (e) {
      throw new UserError('Stopped: couldn\'t update the sheet',
        `Row ${email.row} was ${mode === 'draft' ? 'drafted' : 'sent'}, but its "${CONFIG.STATUS_COLUMN}" cell ` +
        `couldn't be written (${e.message}).\n\n${result.done} email(s) done this run. Stopped here so nobody ` +
        `gets a second copy. Type "${mark}" in row ${email.row}'s "${CONFIG.STATUS_COLUMN}" cell before running again.`);
    }
  }
  return result;
}

function deliver_(email, template, mode) {
  const response = UrlFetchApp.fetch(GMAIL_UPLOAD + (mode === 'draft' ? 'drafts' : 'messages/send') + '?uploadType=media', {
    method: 'post',
    contentType: 'message/rfc822',
    payload: buildMime_(email, template),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  if (status >= 200 && status < 300) return;
  let message = response.getContentText();
  try {
    message = JSON.parse(message).error.message || message;
  } catch (e) {}
  throw new GmailApiError(status, String(message).trim() || `HTTP ${status}`);
}

function isSetupError_(e) {
  return e.status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(e.message);
}

function isLimitError_(e) {
  return e.status === 429 || /limit|quota|too many/i.test(e.message);
}

function buildMime_(email, template) {
  const headers = [];
  const from = fromHeader_();
  if (from) headers.push(`From: ${from}`);
  headers.push(`To: ${email.to.map(encodeAddress_).join(', ')}`);
  if (email.cc.length) headers.push(`Cc: ${email.cc.map(encodeAddress_).join(', ')}`);
  if (email.bcc.length) headers.push(`Bcc: ${email.bcc.map(encodeAddress_).join(', ')}`);
  if (CONFIG.REPLY_TO) headers.push(`Reply-To: ${encodeAddress_(CONFIG.REPLY_TO)}`);
  headers.push(`Subject: ${encodeText_(email.subject)}`);
  headers.push('MIME-Version: 1.0');

  let body = multipart_('alternative', [textPart_('plain', email.text), textPart_('html', email.html)]);
  const cids = Object.keys(template.inlineImages);
  if (cids.length) {
    body = multipart_('related', [body].concat(cids.map((cid) => filePart_(template.inlineImages[cid], cid))));
  }
  const files = template.attachments.concat(email.files);
  if (files.length) {
    body = multipart_('mixed', [body].concat(files.map((file) => filePart_(file, null))));
  }
  return headers.join('\r\n') + '\r\n' + body;
}

function multipart_(subtype, parts) {
  const boundary = 'mm_' + Utilities.getUuid().replace(/-/g, '');
  return `Content-Type: multipart/${subtype}; boundary="${boundary}"\r\n\r\n` +
    parts.map((part) => `--${boundary}\r\n${part}\r\n`).join('') + `--${boundary}--`;
}

function textPart_(subtype, text) {
  return `Content-Type: text/${subtype}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
    wrap_(Utilities.base64Encode(text, Utilities.Charset.UTF_8));
}

function filePart_(blob, cid) {
  const type = blob.getContentType() || 'application/octet-stream';
  const name = quoteName_(blob.getName() || 'attachment');
  const lines = [`Content-Type: ${type}; name=${name}`, 'Content-Transfer-Encoding: base64'];
  if (cid) {
    lines.push(`Content-ID: <${cid}>`, `Content-Disposition: inline; filename=${name}`);
  } else {
    lines.push(`Content-Disposition: attachment; filename=${name}`);
  }
  return lines.join('\r\n') + '\r\n\r\n' + wrap_(Utilities.base64Encode(blob.getBytes()));
}

function wrap_(base64) {
  return (base64.match(/.{1,76}/g) || []).join('\r\n');
}

function fromHeader_() {
  if (!CONFIG.SENDER_NAME) return CONFIG.FROM;
  return `${encodeName_(CONFIG.SENDER_NAME)} <${CONFIG.FROM || Session.getEffectiveUser().getEmail()}>`;
}

function encodeAddress_(part) {
  const m = part.match(/^(.*?)\s*<([^<>]+)>\s*$/);
  if (!m) return oneLine_(part);
  const name = m[1].replace(/^"(.*)"$/, '$1').trim();
  return name ? `${encodeName_(name)} <${m[2].trim()}>` : m[2].trim();
}

function encodeName_(name) {
  name = oneLine_(name);
  return /^[\x20-\x7E]*$/.test(name) ? `"${name.replace(/(["\\])/g, '\\$1')}"` : encodeWord_(name);
}

function encodeText_(text) {
  text = oneLine_(text);
  return /^[\x20-\x7E]*$/.test(text) ? text : encodeWord_(text);
}

function quoteName_(name) {
  name = oneLine_(name);
  return /^[\x20-\x7E]*$/.test(name) ? `"${name.replace(/(["\\])/g, '\\$1')}"` : `"${encodeWord_(name)}"`;
}

function encodeWord_(text) {
  return `=?UTF-8?B?${Utilities.base64Encode(text, Utilities.Charset.UTF_8)}?=`;
}

function oneLine_(text) {
  return String(text).replace(/[\r\n]+/g, ' ').trim();
}

function sendLog_() {
  let log = {};
  try {
    log = JSON.parse(PropertiesService.getUserProperties().getProperty('sendLog') || '{}');
  } catch (e) {}
  const oldest = Math.floor(Date.now() / HOUR_MS) - 23;
  Object.keys(log).forEach((hour) => {
    if (Number(hour) < oldest) delete log[hour];
  });
  return log;
}

function sentInLast24h_() {
  const log = sendLog_();
  return Object.keys(log).reduce((n, hour) => n + log[hour], 0);
}

function recordSends_(count) {
  const log = sendLog_();
  const hour = Math.floor(Date.now() / HOUR_MS);
  log[hour] = (log[hour] || 0) + count;
  PropertiesService.getUserProperties().setProperty('sendLog', JSON.stringify(log));
}

function templateDraft_() {
  const id = PropertiesService.getDocumentProperties().getProperty('templateDraftId');
  if (id) {
    try {
      const draft = GmailApp.getDraft(id);
      if (draft) return draft;
    } catch (e) {}
  }
  return pickDraft_();
}

function pickDraft_() {
  const ui = SpreadsheetApp.getUi();
  const drafts = GmailApp.getDrafts();
  if (!drafts.length) {
    throw new UserError('No Gmail drafts', 'Write the template as a draft in Gmail first: put {{Column Name}} ' +
      'wherever a value from the sheet should go, then choose Mail merge > Choose template draft.');
  }
  const shown = drafts.slice(0, 15);
  const subjects = shown.map((d) => d.getMessage().getSubject() || '(no subject)');
  const response = ui.prompt(
    'Which Gmail draft is the template?',
    `Type its number or its exact subject.\n\n${subjects.map((s, i) => `${i + 1}.  ${s}`).join('\n')}`,
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return null;
  const answer = response.getResponseText().trim();
  const draft = /^\d+$/.test(answer)
    ? shown[Number(answer) - 1]
    : drafts.find((d) => d.getMessage().getSubject() === answer);
  if (!draft) throw new UserError('No such draft', `No draft matches "${answer}".`);
  PropertiesService.getDocumentProperties().setProperty('templateDraftId', draft.getId());
  return draft;
}

function loadTemplate_(draft) {
  const message = draft.getMessage();
  const html = message.getBody();
  const imagesByName = {};
  message.getAttachments({ includeInlineImages: true, includeAttachments: false })
    .forEach((blob) => { imagesByName[blob.getName()] = blob; });
  const inlineImages = {};
  (html.match(/<img[^>]+>/gi) || []).forEach((tag) => {
    const cid = (tag.match(/src="cid:([^"]+)"/i) || [])[1];
    const alt = (tag.match(/alt="([^"]*)"/i) || [])[1];
    if (cid && alt && imagesByName[alt]) inlineImages[cid] = imagesByName[alt];
  });
  return {
    subject: message.getSubject(),
    text: message.getPlainBody(),
    html: html,
    attachments: message.getAttachments({ includeInlineImages: false }),
    inlineImages: inlineImages,
  };
}

function checkTemplate_(template, ctx) {
  if (!template.subject.trim()) {
    throw new UserError('Template has no subject', 'Give the Gmail draft a subject line.');
  }
  const unknown = {};
  [template.subject, template.text, template.html].forEach((part) => {
    for (const m of part.matchAll(PLACEHOLDER)) {
      if (!(placeholderKey_(m[1]) in ctx.index)) unknown[cleanName_(m[1])] = true;
    }
  });
  const names = Object.keys(unknown);
  if (names.length) {
    throw new UserError('Placeholder with no matching column',
      `The draft uses ${names.map((n) => `{{${n}}}`).join(', ')}, but the sheet has no column by that name.\n\n` +
      `Columns are: ${ctx.headers.filter(String).join(', ')}`);
  }
  [template.subject, template.text].forEach((part) => {
    const leftover = part.replace(PLACEHOLDER, '');
    const at = leftover.search(/\{\{|\}\}/);
    if (at !== -1) {
      throw new UserError('Broken placeholder in the draft',
        `Near: "...${leftover.slice(Math.max(0, at - 30), at + 30).replace(/\s+/g, ' ')}..."\n\n` +
        'Placeholders need two braces on each side, like {{First Name}}.');
    }
  });
}

function checkSender_() {
  if (CONFIG.FROM && GmailApp.getAliases().map((a) => a.toLowerCase()).indexOf(CONFIG.FROM.toLowerCase()) === -1) {
    throw new UserError('FROM address not set up', `"${CONFIG.FROM}" isn't one of your Gmail "Send mail as" ` +
      'addresses. Add it in Gmail Settings > Accounts, or clear FROM in the script.');
  }
}

function readSheet_(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) {
    throw new UserError('No data', `The "${sheet.getName()}" sheet needs column headings in row 1 and at least one row of data.`);
  }
  const headers = values[0].map((h) => String(h).trim());
  const index = {};
  headers.forEach((h, i) => {
    if (!h) return;
    const key = norm_(h);
    if (key in index) {
      throw new UserError('Duplicate columns', `Columns "${headers[index[key]]}" and "${h}" have the same name ` +
        'once capitals and spaces are ignored. Rename one.');
    }
    index[key] = i;
  });
  const find = (names) => names.map(norm_).map((k) => index[k]).find((i) => i !== undefined);
  const cols = {
    email: find(COLUMN_NAMES.email),
    cc: find(COLUMN_NAMES.cc),
    bcc: find(COLUMN_NAMES.bcc),
    attachments: find(COLUMN_NAMES.attachments),
    status: index[norm_(CONFIG.STATUS_COLUMN)],
  };
  if (cols.email === undefined) {
    throw new UserError('No Email column', `Name the column of recipient addresses "Email".\n\nColumns are: ${headers.filter(String).join(', ')}`);
  }
  return { values: values, headers: headers, index: index, cols: cols };
}

function pendingRows_(sheet, ctx, mode) {
  const filtered = CONFIG.SKIP_FILTERED_ROWS && sheet.getFilter();
  const rows = [];
  for (let r = 1; r < ctx.values.length; r++) {
    const row = ctx.values[r];
    if (isBlankRow_(row)) continue;
    const status = ctx.cols.status === undefined ? '' : String(row[ctx.cols.status]);
    if (/^Sent\b/.test(status)) continue;
    if (mode === 'draft' && /^Draft\b/.test(status)) continue;
    if (filtered && sheet.isRowHiddenByFilter(r + 1)) continue;
    rows.push(r);
  }
  return rows;
}

function isBlankRow_(row) {
  return row.every((v) => String(v).trim() === '');
}

function ensureStatusColumn_(sheet, ctx) {
  if (ctx.cols.status !== undefined) return;
  ctx.cols.status = ctx.headers.length;
  sheet.getRange(1, ctx.cols.status + 1).setValue(CONFIG.STATUS_COLUMN).setFontWeight('bold');
}

function setStatus_(sheet, ctx, row, text) {
  sheet.getRange(row, ctx.cols.status + 1).setValue(text);
  SpreadsheetApp.flush();
}

function buildEmail_(r, ctx, template, fileCache) {
  const row = ctx.values[r];
  const to = parseAddresses_(row[ctx.cols.email]);
  if (!to.length) throw new RowError('no email address');
  const cc = ctx.cols.cc === undefined ? [] : parseAddresses_(row[ctx.cols.cc]);
  const bcc = ctx.cols.bcc === undefined ? [] : parseAddresses_(row[ctx.cols.bcc]);

  const blanks = {};
  const subject = fill_(template.subject, row, ctx, false, blanks).replace(/\s+/g, ' ').trim();
  const text = fill_(template.text, row, ctx, false, blanks);
  const html = fill_(template.html, row, ctx, true, blanks);
  const empty = Object.keys(blanks);
  if (empty.length && !CONFIG.ALLOW_BLANK) {
    throw new RowError(`${empty.join(', ')} ${empty.length > 1 ? 'are' : 'is'} empty`);
  }
  if (!subject) throw new RowError('the subject comes out empty');

  let files = [];
  if (fileCache && ctx.cols.attachments !== undefined) {
    files = String(row[ctx.cols.attachments]).split(/[,;\n]/)
      .map((s) => s.trim()).filter(String)
      .map((ref) => driveFile_(ref, fileCache));
  }
  return { row: r + 1, to: to, cc: cc, bcc: bcc, subject: subject, text: text, html: html, files: files };
}

function fill_(text, row, ctx, asHtml, blanks) {
  return text.replace(PLACEHOLDER, (match, raw) => {
    const col = ctx.index[placeholderKey_(raw)];
    const value = String(row[col]).trim();
    if (!value) blanks[ctx.headers[col]] = true;
    return asHtml ? escapeHtml_(value).replace(/\r?\n/g, '<br>') : value;
  });
}

function parseAddresses_(value) {
  const out = [];
  String(value).split(/[,;\n]/).forEach((part) => {
    part = part.trim();
    if (!part) return;
    const bracketed = part.match(/<([^<>]+)>\s*$/);
    const address = (bracketed ? bracketed[1] : part).trim();
    if (!ADDRESS.test(address)) throw new RowError(`"${part}" is not a valid email address`);
    out.push(part);
  });
  return out;
}

function driveFile_(ref, cache) {
  const id = (ref.match(/[-\w]{25,}/) || [])[0];
  if (!id) throw new RowError(`attachment "${ref}" isn't a Google Drive link or file ID`);
  if (!(id in cache)) {
    let file;
    try {
      file = DriveApp.getFileById(id);
    } catch (e) {
      throw new RowError(`can't open the Drive file "${ref}"; check the link and that you have access`);
    }
    if (file.getMimeType().indexOf('application/vnd.google-apps.') === 0) {
      cache[id] = file.getAs('application/pdf').setName(file.getName() + '.pdf');
    } else {
      cache[id] = file.getBlob();
    }
  }
  return cache[id];
}

function recipientCount_(email) {
  return email.to.length + email.cc.length + email.bcc.length;
}

function norm_(name) {
  return String(name).replace(/[\s_]+/g, '').toLowerCase();
}

function cleanName_(raw) {
  return raw.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').trim();
}

function placeholderKey_(raw) {
  return norm_(cleanName_(raw));
}

function escapeHtml_(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function now_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

function listProblems_(problems) {
  const shown = problems.slice(0, MAX_LISTED_PROBLEMS).join('\n');
  const more = problems.length - MAX_LISTED_PROBLEMS;
  return more > 0 ? `${shown}\n...and ${more} more` : shown;
}

function previewHtml_(email, template) {
  const line = (label, value) => value ? `<div><b>${label}:</b> ${escapeHtml_(value)}</div>` : '';
  const files = template.attachments.concat(email.files).map((f) => f.getName()).join(', ');
  const body = email.html.replace(/src="cid:([^"]+)"/gi, (match, cid) => {
    const image = template.inlineImages[cid];
    return image ? `src="data:${image.getContentType()};base64,${Utilities.base64Encode(image.getBytes())}"` : match;
  });
  return '<div style="font:13px Arial,sans-serif;color:#444;border-bottom:1px solid #ddd;padding-bottom:10px;margin-bottom:14px">' +
    line('To', email.to.join(', ')) + line('CC', email.cc.join(', ')) + line('BCC', email.bcc.join(', ')) +
    line('Subject', email.subject) + line('Attachments', files) + '</div>' + body;
}

function summaryTitle_(result) {
  if (result.stoppedFor) return 'Paused';
  if (result.failed.length) return 'Finished with errors';
  return 'Done';
}

function summaryText_(mode, result, problems, me) {
  const did = { send: 'sent', draft: 'saved to your Gmail drafts', test: `sent to ${me}` }[mode];
  let text = `${result.done} email(s) ${did}.`;
  if (result.failed.length) {
    text += `\n\n${result.failed.length} failed:\n${listProblems_(result.failed)}`;
    if (mode !== 'test') text += `\n\nThose rows are marked "Error" and will be retried next time.`;
  }
  if (result.stoppedFor === 'time') {
    text += `\n\n${result.left} left. Apps Script limits how long a run can take; choose the same menu item again to carry on.`;
  } else if (result.stoppedFor === 'quota') {
    text += `\n\n${result.left} left: this script reached its DAILY_LIMIT of ${CONFIG.DAILY_LIMIT} recipients ` +
      'in 24 hours. Run it again later to send the rest.';
  } else if (result.stoppedFor === 'gmail') {
    text += `\n\n${result.left} left: Gmail stopped accepting emails (${result.error}). An @gmail.com account can ` +
      'send to about 500 recipients a day. Wait 24 hours, then run it again; rows already sent are skipped.';
  }
  if (problems.length) {
    text += mode === 'test'
      ? `\n\nHeads-up: these rows would stop a real send:\n${listProblems_(problems)}`
      : `\n\nSkipped ${problems.length} row(s) with problems:\n${listProblems_(problems)}`;
  }
  return text;
}
