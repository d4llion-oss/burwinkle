(function () {
  const btn = document.getElementById('btn-copy'), code = document.getElementById('abuse-email'), toast = document.getElementById('toast');
  let t;
  function say(msg) { toast.textContent = msg; toast.classList.add('show'); clearTimeout(t); t = setTimeout(() => toast.classList.remove('show'), 2000); }
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code.textContent.trim()); say('Copied abuse@burwinkle.com'); }
    catch (e) {
      const r = document.createRange(); r.selectNodeContents(code); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      say('Select and copy the address');
    }
  });
})();
