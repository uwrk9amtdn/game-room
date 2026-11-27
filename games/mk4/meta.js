export default {
  id: 'mk4',
  name: 'Mortal Kombat 4',
  description: 'Single player against the computer, from your own game files. Runs only on this computer.',
  players: 1,
  icon: '⚔',
  singlePlayer: true,
  // Listed and served only to connections from this machine while the private
  // build is exported (server/local-game.js); the public server never shows it.
  localOnly: true,
  solo: '/solo/mk4/index.html',
};
