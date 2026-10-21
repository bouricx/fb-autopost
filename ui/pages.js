'use strict';
let pagePending = false;
async function loadPages() {
  const state = await api('/api/state');
  const selector = $('#page-select'), current = selector.value;
  selector.replaceChildren();
  for (const page of state.pages) {
    const option = node('option', page.name); option.value = page.id; selector.append(option);
  }
  if (state.pages.some(p => p.id === current)) selector.value = current;
  const jobs = $('#page-jobs'); jobs.replaceChildren();
  if (!state.jobs.length) jobs.append(node('p', 'ยังไม่มีงานโพสต์เพจ'));
  for (const job of state.jobs) {
    const row = node('article', '', 'activity-row');
    const info = node('div');
    info.append(node('strong', job.page_id + ' · ' + job.status), node('p', job.message),
      node('small', new Date(job.scheduled_at).toLocaleString('th-TH')));
    if (job.error) info.append(node('p', job.error));
    if (job.status === 'queued') info.append(button('ยกเลิก', async () => {
      await api('/api/jobs/' + job.id + '/cancel', 'POST'); await loadPages();
    }));
    row.append(info); jobs.append(row);
  }
}
async function loadProfiles() {
  const select = $('#profile-select'); select.replaceChildren();
  const fallback = node('option', 'ใช้ข้อความในหน้าเขียนโพสต์'); fallback.value = ''; select.append(fallback);
  const list = $('#profile-list'); list.replaceChildren();
  if (!activeId) { list.append(node('p', 'เลือกบัญชีก่อน')); return; }
  const aid = activeId, result = await api('/api/browser/profiles/' + aid);
  if (aid !== activeId) return;
  for (const profile of result.profiles) {
    const option = node('option', profile.name); option.value = profile.id; select.append(option);
    list.append(node('h3', profile.name), node('p', profile.message));
  }
  list.append(node('p', 'ผูกข้อความแล้ว ' + Object.keys(result.assignments).length + ' กลุ่ม', 'footnote'));
}
$('#page-connect').onsubmit = e => {
  e.preventDefault(); const form = e.target;
  perform(async () => {
    try { await api('/api/pages', 'POST', {page_id: form.elements.page_id.value.trim(), token: form.elements.token.value.trim()}); }
    finally { form.elements.token.value = ''; }
    await loadPages(); notice('เชื่อมเพจแล้ว');
  }, form.querySelector('button'));
};
$('#page-post').onsubmit = e => {
  e.preventDefault(); const form = e.target;
  if (!$('#page-select').value) { notice('เชื่อมเพจก่อน', true); return; }
  if (!confirm('ยืนยันส่งข้อความนี้ไปยังเพจที่เลือกตามเวลาที่ระบุ?')) return;
  perform(async () => {
    const date = form.elements.time.value ? new Date(form.elements.time.value) : new Date();
    await api('/api/jobs', 'POST', {page_id: $('#page-select').value, message: form.elements.message.value,
      link: form.elements.link.value, scheduled_at: date.toISOString()});
    await loadPages(); notice('เพิ่มงานเพจแล้ว ติดตามสถานะด้านขวา');
  }, form.querySelector('button'));
};
$('#profile-create').onsubmit = e => {
  e.preventDefault(); const form = e.target;
  perform(async () => {
    if (!activeId) throw Error('เลือกบัญชีก่อน');
    await api('/api/browser/profiles/' + activeId, 'POST', {name: form.elements.name.value, message: form.elements.message.value});
    form.reset(); await loadProfiles(); notice('บันทึกโปรไฟล์แล้ว');
  }, form.querySelector('button'));
};
$('#profile-assign').onclick = () => perform(async () => {
  if (!activeId || !selected().size) throw Error('เลือกบัญชีและกลุ่มก่อน');
  await api('/api/browser/profiles/' + activeId, 'PUT', {urls: [...selected()], profile_id: $('#profile-select').value});
  await loadProfiles(); notice('บันทึกข้อความสำหรับกลุ่มที่เลือกแล้ว ใช้เมื่อเริ่มรอบโพสต์');
}, $('#profile-assign'));
$('#page-refresh').onclick = () => perform(loadPages, $('#page-refresh'));
for (const b of document.querySelectorAll('nav [data-view]')) b.addEventListener('click', () => {
  if (b.dataset.view === 'pages') loadPages().catch(e => notice(e.message, true));
  if (b.dataset.view === 'profiles') loadProfiles().catch(e => notice(e.message, true));
});
$('#active-account').addEventListener('change', () => {
  if (currentView === 'profiles') loadProfiles().catch(e => notice(e.message, true));
});
setInterval(async () => {
  if (currentView !== 'pages' || pagePending || busy || !token) return;
  pagePending = true;
  try { await loadPages(); } catch (e) { notice(e.message, true); } finally { pagePending = false; }
}, 5000);
