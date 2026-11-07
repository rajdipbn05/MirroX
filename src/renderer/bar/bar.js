// The bar above the mirror window, and the "Exit fullscreen" button shown in fullscreen.

const pill = new URLSearchParams(location.search).get('pill') === '1';
document.body.classList.toggle('pill', pill);

const $ = (id) => document.getElementById(id);
$('fullscreen').addEventListener('click', () => window.mirroxBar.action('fullscreen'));
$('exit').addEventListener('click', () => window.mirroxBar.action('fullscreen'));
$('stop').addEventListener('click', () => window.mirroxBar.action('stop'));

window.mirroxBar.onInfo((info) => {
  $('name').textContent = info.name || 'Phone';
  $('fps').textContent = info.fps != null ? `· ${info.fps} FPS` : '';
});
window.mirroxBar.ready();
