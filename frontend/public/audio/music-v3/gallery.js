const players = [...document.querySelectorAll('audio')];
for (const player of players) {
  player.addEventListener('play', () => {
    for (const other of players) if (other !== player) other.pause();
    player.closest('.track').classList.add('is-playing');
  });
  for (const event of ['pause', 'ended', 'error']) player.addEventListener(event, () => player.closest('.track').classList.remove('is-playing'));
}
document.querySelector('#pause-all').addEventListener('click', () => players.forEach(player => player.pause()));
